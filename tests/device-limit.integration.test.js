const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const testDatabaseName = process.env.WHAFEISTY_TEST_DB_NAME;
if (testDatabaseName && !/^[A-Za-z0-9_]+_test$/.test(testDatabaseName)) {
  throw new Error('WHAFEISTY_TEST_DB_NAME must be a valid database name ending in "_test"');
}
if (testDatabaseName && testDatabaseName === process.env.DB_NAME) {
  throw new Error('Database concurrency tests require a target distinct from DB_NAME');
}

test('concurrent device creation and message sending cannot exceed package limits', {
  skip: !testDatabaseName || process.env.NODE_ENV === 'production',
}, async (t) => {
  if (!process.env.DB_PASSWORD) {
    throw new Error('DB_PASSWORD must be set to run database integration tests');
  }

  process.env.DB_NAME = testDatabaseName;
  process.env.NODE_ENV = 'test';

  const { initializeSchema, pool } = require('../dist/services/database/connection');
  const {
    DeviceModel,
    MessageModel,
  } = require('../dist/services/database/models');
  const { DeviceManager } = require('../dist/services/whatsapp/device-manager');
  const { BaileysClient } = require('../dist/services/whatsapp/baileys-client');
  const userId = randomUUID();
  const packageId = randomUUID();
  const accountId = randomUUID();
  const subscriptionId = randomUUID();
  let originalCreateDevice;
  let baileysClient;
  let databaseInitialized = false;

  try {
    baileysClient = BaileysClient;
    originalCreateDevice = baileysClient.createDevice;
    try {
      await pool.query('SELECT 1');
    } catch {
      t.skip('Configured MySQL test service is unavailable');
      return;
    }
    await initializeSchema();
    databaseInitialized = true;
    await pool.execute(
      'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
      [userId, `${userId}@example.test`, 'test-only-hash', 'customer', 'Device Limit Test']
    );
    await pool.execute(
      `INSERT INTO packages
        (id, name, price, device_limit, message_limit, duration_type, duration_value, active)
       VALUES (?, ?, 0, 1, 1, 'monthly', 1, true)`,
      [packageId, `Test package ${packageId}`]
    );
    await pool.execute(
      `INSERT INTO accounts (id, user_id, name, max_devices, package_id)
       VALUES (?, ?, ?, 1, ?)`,
      [accountId, userId, 'Device Limit Test Account', packageId]
    );
    await pool.execute(
      `INSERT INTO subscriptions (id, user_id, package_id, status, start_date, end_date)
       VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY))`,
      [subscriptionId, userId, packageId]
    );

    baileysClient.createDevice = async (id) => DeviceModel.create(id);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => DeviceManager.createDevice(accountId))
    );
    baileysClient.createDevice = originalCreateDevice;
    const created = results.filter((result) => result.success);
    const rejected = results.filter((result) => !result.success);

    assert.equal(results.length, 8, 'eight device requests must execute');
    assert.equal(created.length, 1, 'only the remaining package slot should be created');
    assert.equal(rejected.length, 7, 'all other concurrent attempts should be rejected');
    assert.ok(rejected.every((result) => result.error === 'Device limit reached (1)'));

    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS count FROM devices WHERE account_id = ?',
      [accountId]
    );
    assert.equal(Number(countRows[0].count), 1);

    const deviceId = created[0].data.id;
    const [usageBeforeRows] = await pool.execute(
      `SELECT COUNT(*) AS count FROM messages m
       JOIN devices d ON d.id = m.device_id
       JOIN accounts a ON a.id = d.account_id
       WHERE a.user_id = ? AND m.direction = 'outbound'
         AND m.created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01 00:00:00')`,
      [userId]
    );
    const usageBefore = Number(usageBeforeRows[0].count);
    const quotaResults = await Promise.all(
      Array.from({ length: 8 }, () =>
        MessageModel.withAtomicMonthlyQuota(userId, async () => {
          return MessageModel.create({
            from_number: '628123456789',
            to_number: '628987654321',
            content: 'Test message attempt',
            status: 'error',
            message_id: null,
            direction: 'outbound',
            device_id: deviceId,
          });
        })
      )
    );
    const reserved = quotaResults.filter((result) => !result.quotaExceeded);
    const quotaRejected = quotaResults.filter((result) => result.quotaExceeded);
    assert.equal(quotaResults.length, 8, 'eight message quota requests must execute');
    assert.equal(reserved.length, 1);
    assert.equal(quotaRejected.length, 7);
    const [usageAfterRows] = await pool.execute(
      `SELECT COUNT(*) AS count FROM messages m
       JOIN devices d ON d.id = m.device_id
       JOIN accounts a ON a.id = d.account_id
       WHERE a.user_id = ? AND m.direction = 'outbound'
         AND m.created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01 00:00:00')`,
      [userId]
    );
    const usageAfter = Number(usageAfterRows[0].count);
    assert.equal(usageBefore, 0);
    assert.equal(usageAfter, 1);
    assert.equal(usageAfter - usageBefore, 1, 'monthly quota must not be exceeded');
    console.log(JSON.stringify({
      test: 'mysql_device_and_quota_concurrency',
      deviceRequests: results.length,
      devicesCreated: created.length,
      deviceLimitRejected: rejected.length,
      deviceRecordsAfter: Number(countRows[0].count),
      messageReservations: quotaResults.length,
      messageQuotaRejected: quotaRejected.length,
      messageUsageBefore: usageBefore,
      messageUsageAfter: usageAfter,
      deadlockOrTimeoutErrors: 0,
    }));
  } finally {
    if (typeof originalCreateDevice === 'function' && baileysClient) {
      baileysClient.createDevice = originalCreateDevice;
    }
    try {
      if (databaseInitialized) {
        await pool.execute('DELETE FROM accounts WHERE id = ?', [accountId]);
        await pool.execute('DELETE FROM subscriptions WHERE id = ?', [subscriptionId]);
        await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.execute('DELETE FROM packages WHERE id = ?', [packageId]);
      }
    } finally {
      await pool.end();
    }
  }
});
