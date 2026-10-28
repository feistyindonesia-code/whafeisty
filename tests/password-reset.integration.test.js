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
  throw new Error('Password reset integration tests require a target distinct from DB_NAME');
}

test('password reset is one-time, expires, updates the password, and revokes existing JWTs', {
  skip: !testDatabaseName || process.env.NODE_ENV === 'production',
}, async (t) => {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD must be set for MySQL integration tests');
  process.env.DB_NAME = testDatabaseName;
  process.env.NODE_ENV = 'development';
  process.env.JWT_SECRET = randomBytes(32).toString('hex');

  const { pool, assertDatabaseSchemaCurrent } = require('../dist/services/database/connection');
  const { UserModel } = require('../dist/services/database/models');
  const { generateToken, jwtAuth } = require('../dist/middleware/jwt');
  const usersRouter = require('../dist/api/v1/users').default;
  const { createPasswordResetCode } = require('../dist/services/security/password-reset');

  const email = `${randomUUID()}@example.test`;
  const expiredEmail = `${randomUUID()}@example.test`;
  const bruteForceEmail = `${randomUUID()}@example.test`;
  let userId;
  let expiredUserId;
  let bruteForceUserId;
  let server;
  const fixtureUserIds = [];

  try {
    try {
      await pool.query('SELECT 1');
    } catch {
      t.skip('Configured MySQL test service is unavailable');
      return;
    }
    await assertDatabaseSchemaCurrent();
    const user = await UserModel.create(email, 'Old-password-123', 'customer', 'Password reset test');
    userId = user.id;
    fixtureUserIds.push(userId);
    expiredUserId = (await UserModel.create(expiredEmail, 'Old-password-123', 'customer', 'Expired reset test')).id;
    fixtureUserIds.push(expiredUserId);
    bruteForceUserId = (await UserModel.create(bruteForceEmail, 'Old-password-123', 'customer', 'Brute force reset test')).id;
    fixtureUserIds.push(bruteForceUserId);
    const oldToken = generateToken(user);
    const validReset = createPasswordResetCode();
    const expiredReset = createPasswordResetCode();
    const bruteForceReset = createPasswordResetCode();
    await pool.execute(
      'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [randomUUID(), userId, validReset.codeHash, new Date(Date.now() + 5 * 60 * 1000)]
    );
    await pool.execute(
      'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [randomUUID(), expiredUserId, expiredReset.codeHash, new Date(Date.now() - 60 * 1000)]
    );
    await pool.execute(
      'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [randomUUID(), bruteForceUserId, bruteForceReset.codeHash, new Date(Date.now() + 5 * 60 * 1000)]
    );

    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/api/v1/users', usersRouter);
    app.get('/protected', jwtAuth, (_req, res) => res.json({ success: true }));
    server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let requestIp = 1;
    const postReset = (resetEmail, code) => fetch(`${baseUrl}/api/v1/users/password/reset`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `192.0.2.${requestIp++}`,
      },
      body: JSON.stringify({ email: resetEmail, code, password: 'New-password-456' }),
    });

    const success = await postReset(email, validReset.code);
    assert.equal(success.status, 200);
    assert.equal((await postReset(email, validReset.code)).status, 400);
    assert.equal((await postReset(expiredEmail, expiredReset.code)).status, 400);
    const wrongCode = bruteForceReset.code === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await postReset(bruteForceEmail, wrongCode)).status, 400);
    }
    assert.equal((await postReset(bruteForceEmail, bruteForceReset.code)).status, 400);
    assert.equal(await UserModel.verifyPassword('New-password-456', (await UserModel.findById(userId)).password_hash), true);
    const [versionRows] = await pool.execute('SELECT auth_token_version FROM users WHERE id = ?', [userId]);
    assert.equal(Number(versionRows[0].auth_token_version), 1);
    const oldJwtResponse = await fetch(`${baseUrl}/protected`, {
      headers: { authorization: `Bearer ${oldToken}` },
    });
    assert.equal(oldJwtResponse.status, 401);

    const [storedTokenRows] = await pool.execute(
      'SELECT token_hash FROM password_reset_tokens WHERE user_id = ?',
      [userId]
    );
    assert.ok(storedTokenRows.every((row) => /^[a-f0-9]{64}$/.test(row.token_hash)));
    assert.equal(storedTokenRows.some((row) => row.token_hash === validReset.code), false);
    const [attemptRows] = await pool.execute(
      'SELECT attempt_count FROM password_reset_tokens WHERE token_hash = ?',
      [bruteForceReset.codeHash]
    );
    assert.equal(Number(attemptRows[0].attempt_count), 5);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const fixtureUserId of fixtureUserIds) {
      await pool.execute('DELETE FROM users WHERE id = ?', [fixtureUserId]);
    }
    await pool.end();
  }
});
