const { randomUUID, randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const assert = require('node:assert/strict');
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
  throw new Error('API key integration tests require a target distinct from DB_NAME');
}

test('API key authentication enforces hash, expiry, revocation, scopes, rotation, and account isolation', {
  skip: !testDatabaseName || process.env.NODE_ENV === 'production',
}, async (t) => {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD must be set for MySQL integration tests');
  process.env.DB_NAME = testDatabaseName;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = randomBytes(32).toString('hex');

  const { pool, assertDatabaseSchemaCurrent } = require('../dist/services/database/connection');
  const { ApiKeyModel } = require('../dist/services/database/models');
  const { hasApiKeyScope } = require('../dist/services/security/api-keys');
  const { apiKeyAuth, deviceOwnership, requireApiKeyScope } = require('../dist/middleware/auth');
  const userIds = [randomUUID(), randomUUID()];
  const accountIds = [randomUUID(), randomUUID()];
  const otherDeviceId = randomUUID();
  let server;
  let databaseAvailable = false;

  try {
    try {
      await pool.query('SELECT 1');
      databaseAvailable = true;
    } catch {
      t.skip('Configured MySQL test service is unavailable');
      return;
    }
    await assertDatabaseSchemaCurrent();
    for (let index = 0; index < userIds.length; index += 1) {
      await pool.execute(
        'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
        [userIds[index], `${userIds[index]}@example.test`, 'test-only-hash', 'customer', 'API key test']
      );
      await pool.execute(
        'INSERT INTO accounts (id, user_id, name) VALUES (?, ?, ?)',
        [accountIds[index], userIds[index], 'API key integration test']
      );
    }
    await pool.execute(
      `INSERT INTO devices (id, account_id, status, connection_status)
       VALUES (?, ?, 'offline', 'disconnected')`,
      [otherDeviceId, accountIds[1]]
    );

    const first = await ApiKeyModel.create({
      accountId: accountIds[0],
      actorUserId: userIds[0],
      name: 'test key',
      scopes: ['messages:read'],
      expiresAt: null,
    });
    const authenticated = await ApiKeyModel.findPresentedKey(first.secret);
    assert.equal(authenticated.key.account_id, accountIds[0]);
    assert.equal(authenticated.key.user_id, userIds[0]);
    assert.equal(hasApiKeyScope(authenticated.key.permissions, 'messages:send'), false);
    assert.equal((await ApiKeyModel.findPresentedKey(`${first.secret}invalid`)).key, null);

    const listing = await ApiKeyModel.findByAccountId(accountIds[0]);
    assert.equal(listing.length, 1);
    assert.equal(Object.hasOwn(listing[0], 'secret'), false);
    assert.equal(Object.hasOwn(listing[0], 'key_hash'), false);
    assert.equal(Object.hasOwn(listing[0], 'key'), false);

    const rotated = await ApiKeyModel.rotate({
      accountId: accountIds[0],
      actorUserId: userIds[0],
      id: first.key.id,
    });
    assert.ok(rotated);
    assert.equal((await ApiKeyModel.findPresentedKey(first.secret)).key, null);
    assert.equal((await ApiKeyModel.findPresentedKey(rotated.secret)).key.id, rotated.key.id);

    const expired = await ApiKeyModel.create({
      accountId: accountIds[0],
      actorUserId: userIds[0],
      name: 'expired test key',
      scopes: ['devices:read'],
      expiresAt: new Date(Date.now() - 60_000),
    });
    assert.equal((await ApiKeyModel.findPresentedKey(expired.secret)).reason, 'expired');

    assert.equal(await ApiKeyModel.revoke({
      accountId: accountIds[0],
      actorUserId: userIds[0],
      id: rotated.key.id,
    }), true);
    assert.equal((await ApiKeyModel.findPresentedKey(rotated.secret)).key, null);

    const otherAccountKey = await ApiKeyModel.create({
      accountId: accountIds[1],
      actorUserId: userIds[1],
      name: 'other account key',
      scopes: ['devices:read'],
      expiresAt: null,
    });
    const otherAuthenticated = await ApiKeyModel.findPresentedKey(otherAccountKey.secret);
    assert.equal(otherAuthenticated.key.account_id, accountIds[1]);
    assert.notEqual(otherAuthenticated.key.account_id, accountIds[0]);

    const sendKey = await ApiKeyModel.create({
      accountId: accountIds[0],
      actorUserId: userIds[0],
      name: 'send scope test',
      scopes: ['messages:send'],
      expiresAt: null,
    });
    const deviceReadKey = await ApiKeyModel.create({
      accountId: accountIds[0],
      actorUserId: userIds[0],
      name: 'device read scope test',
      scopes: ['devices:read'],
      expiresAt: null,
    });
    const app = express();
    app.get('/send', apiKeyAuth, requireApiKeyScope('messages:send'), (_req, res) => res.sendStatus(204));
    app.get('/devices/:deviceId', apiKeyAuth, requireApiKeyScope('devices:read'), deviceOwnership, (_req, res) => res.sendStatus(204));
    server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const call = (url, secret) => fetch(`${baseUrl}${url}`, {
      headers: secret ? { 'x-api-key': secret } : {},
    });
    assert.equal((await call('/send', first.secret)).status, 403, 'insufficient scope must be rejected');
    assert.equal((await call('/send', sendKey.secret)).status, 204, 'valid key and scope must be accepted');
    assert.equal((await call('/send', `${sendKey.secret}invalid`)).status, 403);
    assert.equal((await call('/send')).status, 401);
    assert.equal((await call('/send', expired.secret)).status, 403);
    assert.equal((await call('/send', rotated.secret)).status, 403);
    assert.equal((await call(`/devices/${otherDeviceId}`, deviceReadKey.secret)).status, 403,
      'an API key must not access a different account device');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (databaseAvailable) {
      for (const accountId of accountIds) {
        await pool.execute('DELETE FROM accounts WHERE id = ?', [accountId]);
      }
      for (const userId of userIds) {
        await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
      }
    }
    await pool.end();
  }
});
