const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const { test } = require('node:test');
const express = require('express');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const testDatabaseName = process.env.WHAFEISTY_TEST_DB_NAME;
const testRedisUrl = process.env.WHAFEISTY_TEST_REDIS_URL;
if (testDatabaseName && !/^[A-Za-z0-9_]+_test$/.test(testDatabaseName)) {
  throw new Error('WHAFEISTY_TEST_DB_NAME must be a valid database name ending in "_test"');
}
if (testDatabaseName && testDatabaseName === process.env.DB_NAME) {
  throw new Error('Authentication integration tests require a target distinct from DB_NAME');
}
if (testRedisUrl && !/^\/[1-9]\d*$/.test(new URL(testRedisUrl).pathname)) {
  throw new Error('WHAFEISTY_TEST_REDIS_URL must select a dedicated non-zero Redis database index');
}

test('authentication, role, ownership, expiry, payment idempotency, and real Redis limits', {
  skip: !testDatabaseName || !testRedisUrl || process.env.NODE_ENV === 'production',
}, async (t) => {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD must be set for MySQL integration tests');
  process.env.DB_NAME = testDatabaseName;
  process.env.REDIS_URL = testRedisUrl;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = randomBytes(32).toString('hex');

  const { pool, assertDatabaseSchemaCurrent } = require('../dist/services/database/connection');
  const { UserModel, PaymentModel } = require('../dist/services/database/models');
  const { generateToken } = require('../dist/middleware/jwt');
  const usersRouter = require('../dist/api/v1/users').default;
  const devicesRouter = require('../dist/api/v1/devices').default;
  const { loginRateLimitStore, registrationRateLimitStore } = require('../dist/middleware/redis-rate-limit-store');

  const packageId = randomUUID();
  const primaryUserId = randomUUID();
  const otherUserId = randomUUID();
  const expiredUserId = randomUUID();
  const paymentUserId = randomUUID();
  const adminId = randomUUID();
  const subscriptionIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const paymentId = randomUUID();
  const deviceId = randomUUID();
  const accountsToClean = [];
  const registeredUserIds = [];
  let server;
  let redisPreflight;
  let redisAvailable = false;
  let databaseAvailable = false;

  try {
    const Redis = require('ioredis');
    redisPreflight = new Redis(testRedisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      connectTimeout: 1500,
    });
    try {
      await redisPreflight.connect();
      redisAvailable = true;
    } catch {
      t.skip('Configured test Redis service is unavailable');
      return;
    } finally {
      if (redisPreflight.status !== 'end') await redisPreflight.quit();
    }

    try {
      await pool.query('SELECT 1');
      databaseAvailable = true;
    } catch {
      t.skip('Configured MySQL test service is unavailable');
      return;
    }
    await assertDatabaseSchemaCurrent();
    await pool.execute(
      `INSERT INTO packages
        (id, name, price, device_limit, message_limit, duration_type, duration_value, active)
       VALUES (?, ?, 0, 2, 20, 'monthly', 1, true)`,
      [packageId, `Auth behavior package ${packageId}`]
    );
    await pool.execute(
      'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
      [primaryUserId, `${primaryUserId}@example.test`, 'unused', 'customer', 'Auth test customer']
    );
    await pool.execute(
      'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
      [otherUserId, `${otherUserId}@example.test`, 'unused', 'customer', 'Other test customer']
    );
    await pool.execute(
      'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
      [expiredUserId, `${expiredUserId}@example.test`, 'unused', 'customer', 'Expired test customer']
    );
    await pool.execute(
      'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
      [paymentUserId, `${paymentUserId}@example.test`, 'unused', 'customer', 'Payment test customer']
    );
    await pool.execute(
      'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
      [adminId, `${adminId}@example.test`, 'unused', 'superadmin', 'Auth test admin']
    );
    const primaryAccountId = randomUUID();
    const otherAccountId = randomUUID();
    const expiredAccountId = randomUUID();
    const paymentAccountId = randomUUID();
    accountsToClean.push(primaryAccountId, otherAccountId, expiredAccountId, paymentAccountId);
    for (const [accountId, userId] of [
      [primaryAccountId, primaryUserId],
      [otherAccountId, otherUserId],
      [expiredAccountId, expiredUserId],
      [paymentAccountId, paymentUserId],
    ]) {
      await pool.execute(
        'INSERT INTO accounts (id, user_id, name, package_id) VALUES (?, ?, ?, ?)',
        [accountId, userId, 'Auth behavior account', packageId]
      );
    }
    await pool.execute(
      `INSERT INTO subscriptions (id, user_id, package_id, status, start_date, end_date)
       VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY))`,
      [subscriptionIds[0], primaryUserId, packageId]
    );
    await pool.execute(
      `INSERT INTO subscriptions (id, user_id, package_id, status, start_date, end_date)
       VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY))`,
      [subscriptionIds[1], otherUserId, packageId]
    );
    await pool.execute(
      `INSERT INTO subscriptions (id, user_id, package_id, status, start_date, end_date)
       VALUES (?, ?, ?, 'active', DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 DAY), DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY))`,
      [subscriptionIds[2], expiredUserId, packageId]
    );
    await pool.execute(
      `INSERT INTO subscriptions (id, user_id, package_id, status)
       VALUES (?, ?, ?, 'pending')`,
      [subscriptionIds[3], paymentUserId, packageId]
    );
    await pool.execute(
      `INSERT INTO devices (id, account_id, status, connection_status)
       VALUES (?, ?, 'offline', 'disconnected')`,
      [deviceId, primaryAccountId]
    );
    await pool.execute(
      `INSERT INTO payments (id, user_id, package_id, amount, method, status)
       VALUES (?, ?, ?, 0, 'test', 'pending')`,
      [paymentId, paymentUserId, packageId]
    );

    const customer = await UserModel.create(`${randomUUID()}@example.test`, 'test-password-123', 'customer', 'Login test');
    registeredUserIds.push(customer.id);
    const customerPassword = 'test-password-123';
    const adminToken = generateToken({ id: adminId, email: `${adminId}@example.test`, role: 'superadmin' });
    const primaryToken = generateToken({ id: primaryUserId, email: `${primaryUserId}@example.test`, role: 'customer' });
    const otherToken = generateToken({ id: otherUserId, email: `${otherUserId}@example.test`, role: 'customer' });
    const expiredToken = generateToken({ id: expiredUserId, email: `${expiredUserId}@example.test`, role: 'customer' });
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/api/v1/users', usersRouter);
    app.use('/api/v1/devices', devicesRouter);
    server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
    const loginIp = `192.0.2.${10 + Math.floor(Math.random() * 200)}`;
    const registerIp = `198.51.100.${10 + Math.floor(Math.random() * 200)}`;
    await loginRateLimitStore.resetKey(loginIp);
    await registrationRateLimitStore.resetKey(registerIp);

    const login = (ip, email, password) => fetch(`${baseUrl}/users/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, password }),
    });
    const badLogins = await Promise.all(
      Array.from({ length: 11 }, () => login(loginIp, 'missing@example.test', 'invalid-password'))
    );
    assert.equal(badLogins.filter((response) => response.status === 401).length, 10);
    assert.equal(badLogins.filter((response) => response.status === 429).length, 1);

    const validLogin = await login('203.0.113.55', customer.email, customerPassword);
    assert.equal(validLogin.status, 200);
    const loginBody = await validLogin.json();
    assert.equal((await fetch(`${baseUrl}/users/me`, {
      headers: { authorization: `Bearer ${loginBody.data.token}` },
    })).status, 200);
    assert.equal((await fetch(`${baseUrl}/users/me`, {
      headers: { authorization: 'Bearer invalid.token.value' },
    })).status, 401);
    assert.equal((await fetch(`${baseUrl}/users/api-keys`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })).status, 403);
    assert.equal((await fetch(`${baseUrl}/devices/${deviceId}`, {
      headers: { authorization: `Bearer ${otherToken}` },
    })).status, 403);
    assert.equal((await fetch(`${baseUrl}/devices`, {
      headers: { authorization: `Bearer ${primaryToken}` },
    })).status, 200);
    assert.equal((await fetch(`${baseUrl}/devices`, {
      headers: { authorization: `Bearer ${expiredToken}` },
    })).status, 403);

    const registrations = await Promise.all(
      Array.from({ length: 6 }, (_, index) => fetch(`${baseUrl}/users/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': registerIp },
        body: JSON.stringify({
          name: `Registration test ${index}`,
          email: `${randomUUID()}@example.test`,
          password: 'registration-password',
          package_id: packageId,
        }),
      }))
    );
    for (const response of registrations) {
      if (response.status === 201) {
        const body = await response.json();
        registeredUserIds.push(body.data.user.id);
      }
    }
    assert.equal(registrations.filter((response) => response.status === 201).length, 5);
    assert.equal(registrations.filter((response) => response.status === 429).length, 1);

    assert.equal(await PaymentModel.approveAndActivateSubscription(paymentId, adminId), 'approved');
    assert.equal(await PaymentModel.approveAndActivateSubscription(paymentId, adminId), 'already_processed');
    const [paymentRows] = await pool.execute(
      `SELECT p.status, COUNT(s.id) AS active_subscriptions
       FROM payments p LEFT JOIN subscriptions s
         ON s.user_id = p.user_id AND s.package_id = p.package_id AND s.status = 'active'
       WHERE p.id = ? GROUP BY p.id, p.status`,
      [paymentId]
    );
    assert.equal(paymentRows[0].status, 'paid');
    assert.equal(Number(paymentRows[0].active_subscriptions), 1);

    await loginRateLimitStore.resetKey(loginIp);
    await registrationRateLimitStore.resetKey(registerIp);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (redisAvailable) {
      await loginRateLimitStore.shutdown();
    }
    try {
      if (databaseAvailable) {
        for (const accountId of accountsToClean) await pool.execute('DELETE FROM accounts WHERE id = ?', [accountId]);
        for (const subscriptionId of subscriptionIds) await pool.execute('DELETE FROM subscriptions WHERE id = ?', [subscriptionId]);
        for (const userId of [primaryUserId, otherUserId, expiredUserId, paymentUserId, adminId, ...registeredUserIds]) {
          await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        }
        await pool.execute('DELETE FROM packages WHERE id = ?', [packageId]);
      }
    } finally {
      await pool.end();
    }
  }
});
