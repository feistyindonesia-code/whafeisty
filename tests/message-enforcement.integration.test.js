const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const { test } = require('node:test');
const express = require('express');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const testDatabaseName = process.env.WHAFEISTY_TEST_DB_NAME;
if (testDatabaseName && !/^[A-Za-z0-9_]+_test$/.test(testDatabaseName)) {
  throw new Error('WHAFEISTY_TEST_DB_NAME must be a valid database name ending in "_test"');
}
if (testDatabaseName && testDatabaseName === process.env.DB_NAME) {
  throw new Error('Message integration tests require a target distinct from DB_NAME');
}

test('message endpoint serializes quota, consent revocation, and paused sending under concurrency', {
  skip: !testDatabaseName || process.env.NODE_ENV === 'production',
}, async (t) => {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD must be set for MySQL integration tests');
  process.env.DB_NAME = testDatabaseName;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = randomBytes(32).toString('hex');

  const { pool, assertDatabaseSchemaCurrent } = require('../dist/services/database/connection');
  const { generateToken } = require('../dist/middleware/jwt');
  const {
    ContactConsentModel,
    DeviceModel,
    SendSafetyModel,
  } = require('../dist/services/database/models');
  const { BaileysClient } = require('../dist/services/whatsapp/baileys-client');
  const messageRoutes = require('../dist/api/v1/messages').default;

  const fixtures = [0, 1].map(() => ({
    userId: randomUUID(),
    packageId: randomUUID(),
    accountId: randomUUID(),
    subscriptionId: randomUUID(),
    deviceId: randomUUID(),
  }));
  let originalSendMessage;
  let originalGetOwnNumber;
  let server;
  let releaseProvider;
  let providerStartedResolve;
  const providerStarted = new Promise((resolve) => { providerStartedResolve = resolve; });
  let providerCalls = 0;
  let holdNextProviderCall = false;
  let databaseAvailable = false;
  const waitForProviderStart = async () => {
    let timeout;
    try {
      await Promise.race([
        providerStarted,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Provider mock was not reached')), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    try {
      await pool.query('SELECT 1');
      databaseAvailable = true;
    } catch {
      t.skip('Configured MySQL test service is unavailable');
      return;
    }
    await assertDatabaseSchemaCurrent();
    for (let index = 0; index < fixtures.length; index += 1) {
      const fixture = fixtures[index];
      await pool.execute(
        'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
        [fixture.userId, `${fixture.userId}@example.test`, 'test-only-hash', 'customer', 'Message enforcement test']
      );
      await pool.execute(
        `INSERT INTO packages
          (id, name, price, device_limit, message_limit, duration_type, duration_value, active)
         VALUES (?, ?, 0, 1, ?, 'monthly', 1, true)`,
        [fixture.packageId, `Message test package ${fixture.packageId}`, index === 0 ? 1 : 20]
      );
      await pool.execute(
        'INSERT INTO accounts (id, user_id, name, max_devices, package_id) VALUES (?, ?, ?, 1, ?)',
        [fixture.accountId, fixture.userId, 'Message integration account', fixture.packageId]
      );
      await pool.execute(
        `INSERT INTO subscriptions (id, user_id, package_id, status, start_date, end_date)
         VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY))`,
        [fixture.subscriptionId, fixture.userId, fixture.packageId]
      );
      await pool.execute(
        `INSERT INTO devices (id, account_id, status, connection_status)
         VALUES (?, ?, 'online', 'connected')`,
        [fixture.deviceId, fixture.accountId]
      );
    }

    const acceptedPhone = '628111111110';
    const racePhone = '628222222220';
    const pausedPhone = '628333333330';
    await ContactConsentModel.recordConsent({
      accountId: fixtures[0].accountId,
      phoneNumber: acceptedPhone,
      purpose: 'integration test',
      source: 'test fixture',
      evidence: 'synthetic test consent',
      recordedBy: fixtures[0].userId,
    });
    for (const phoneNumber of [racePhone, pausedPhone]) {
      await ContactConsentModel.recordConsent({
        accountId: fixtures[1].accountId,
        phoneNumber,
        purpose: 'integration test',
        source: 'test fixture',
        evidence: 'synthetic test consent',
        recordedBy: fixtures[1].userId,
      });
    }

    originalSendMessage = BaileysClient.sendMessage;
    originalGetOwnNumber = BaileysClient.getOwnNumber;
    BaileysClient.getOwnNumber = () => '628000000000';
    BaileysClient.sendMessage = async () => {
      providerCalls += 1;
      if (holdNextProviderCall) {
        holdNextProviderCall = false;
        providerStartedResolve();
        await new Promise((resolve) => { releaseProvider = resolve; });
      }
      return { key: { id: randomUUID() } };
    };

    const app = express();
    app.use(express.json());
    app.use('/api/v1/messages', messageRoutes);
    server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1/messages`;
    const tokens = fixtures.map((fixture) => generateToken({
      id: fixture.userId,
      email: `${fixture.userId}@example.test`,
      role: 'customer',
    }));
    const sendRequest = (fixtureIndex, phoneNumber) => fetch(baseUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens[fixtureIndex]}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        device_id: fixtures[fixtureIndex].deviceId,
        to_number: phoneNumber,
        content: 'Synthetic integration test message',
      }),
    });
    const quotaBefore = 0;
    const quotaResponses = await Promise.all(
      Array.from({ length: 8 }, () => sendRequest(0, acceptedPhone))
    );
    const quotaStatus = quotaResponses.map((response) => response.status);
    const quotaAccepted = quotaStatus.filter((status) => status === 201).length;
    const quotaRejected = quotaStatus.filter((status) => status === 403).length;
    assert.equal(quotaResponses.length, 8);
    assert.equal(quotaAccepted, 1);
    assert.equal(quotaRejected, 7);
    assert.equal(providerCalls, 1, 'quota-rejected requests must not reach the WhatsApp provider');
    const [firstUsageRows] = await pool.execute(
      `SELECT COUNT(*) AS count FROM messages m JOIN devices d ON d.id = m.device_id
       WHERE d.account_id = ? AND m.direction = 'outbound'`,
      [fixtures[0].accountId]
    );
    assert.equal(Number(firstUsageRows[0].count), 1);

    holdNextProviderCall = true;
    const inFlightSend = sendRequest(1, racePhone);
    await waitForProviderStart();
    await ContactConsentModel.revokeConsent({
      accountId: fixtures[1].accountId,
      phoneNumber: racePhone,
      source: 'test concurrent opt-out',
      evidence: 'revoked during provider call',
      recordedBy: fixtures[1].userId,
    });
    releaseProvider();
    const inFlightResponse = await inFlightSend;
    assert.equal(inFlightResponse.status, 201);
    const afterRevokeResponse = await sendRequest(1, racePhone);
    assert.equal(afterRevokeResponse.status, 403);

    await SendSafetyModel.resume(fixtures[1].accountId);
    await SendSafetyModel.recordFailure(fixtures[1].accountId, 1, 60);
    const pausedResponses = await Promise.all(
      Array.from({ length: 8 }, () => sendRequest(1, pausedPhone))
    );
    assert.ok(pausedResponses.every((response) => response.status === 423));
    assert.equal(providerCalls, 2, 'paused requests must not reach the provider');
    const [finalUsageRows] = await pool.execute(
      `SELECT COUNT(*) AS count FROM messages m JOIN devices d ON d.id = m.device_id
       WHERE d.account_id = ? AND m.direction = 'outbound'`,
      [fixtures[1].accountId]
    );
    assert.equal(Number(finalUsageRows[0].count), 1);
    assert.equal(quotaBefore, 0);
    assert.equal(Number(firstUsageRows[0].count), 1);
    const allStatuses = [
      ...quotaStatus,
      inFlightResponse.status,
      afterRevokeResponse.status,
      ...pausedResponses.map((response) => response.status),
    ];
    const deadlockOrTimeoutErrors = allStatuses.filter((status) => status >= 500).length;
    assert.equal(deadlockOrTimeoutErrors, 0);
    console.log(JSON.stringify({
      test: 'mysql_message_consent_pause_concurrency',
      requests: allStatuses.length,
      successfulSends: quotaAccepted + (inFlightResponse.status === 201 ? 1 : 0),
      rejected: quotaRejected + (afterRevokeResponse.status === 403 ? 1 : 0) +
        pausedResponses.filter((response) => response.status === 423).length,
      providerCalls,
      quotaUsageBefore: quotaBefore,
      quotaUsageAfter: Number(firstUsageRows[0].count),
      accountMessageRecordsAfter: Number(finalUsageRows[0].count),
      deadlockOrTimeoutErrors,
    }));
  } finally {
    if (releaseProvider) releaseProvider();
    if (originalSendMessage) BaileysClient.sendMessage = originalSendMessage;
    if (originalGetOwnNumber) BaileysClient.getOwnNumber = originalGetOwnNumber;
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
      if (databaseAvailable) {
        for (const fixture of fixtures) {
          await pool.execute('DELETE FROM accounts WHERE id = ?', [fixture.accountId]);
          await pool.execute('DELETE FROM subscriptions WHERE id = ?', [fixture.subscriptionId]);
          await pool.execute('DELETE FROM users WHERE id = ?', [fixture.userId]);
          await pool.execute('DELETE FROM packages WHERE id = ?', [fixture.packageId]);
        }
      }
    } finally {
      await pool.end();
    }
  }
});
