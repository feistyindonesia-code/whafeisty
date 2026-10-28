const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
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
  throw new Error('Media integration tests require a target distinct from DB_NAME');
}

test('media HTTP routes enforce authentication, owner isolation, MIME signatures, and 16 MiB maximum', {
  skip: !testDatabaseName || process.env.NODE_ENV === 'production',
}, async (t) => {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD must be set for MySQL integration tests');
  process.env.DB_NAME = testDatabaseName;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = randomBytes(32).toString('hex');

  const originalCwd = process.cwd();
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'whafeisty-media-http-test-'));
  process.chdir(temporaryDirectory);
  const { pool, assertDatabaseSchemaCurrent } = require('../dist/services/database/connection');
  const { generateToken } = require('../dist/middleware/jwt');
  const mediaRoutes = require('../dist/api/v1/media').default;
  const users = [randomUUID(), randomUUID()];
  const accounts = [randomUUID(), randomUUID()];
  const subscriptions = [randomUUID(), randomUUID()];
  const packageId = randomUUID();
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
    await pool.execute(
      `INSERT INTO packages
        (id, name, price, device_limit, message_limit, duration_type, duration_value, active)
       VALUES (?, ?, 0, 1, 10, 'monthly', 1, true)`,
      [packageId, `Media HTTP test package ${packageId}`]
    );
    for (let index = 0; index < users.length; index += 1) {
      await pool.execute(
        'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
        [users[index], `${users[index]}@example.test`, 'test-only-hash', 'customer', 'Media HTTP test']
      );
      await pool.execute(
        'INSERT INTO accounts (id, user_id, name, package_id) VALUES (?, ?, ?, ?)',
        [accounts[index], users[index], 'Media HTTP test account', packageId]
      );
      await pool.execute(
        `INSERT INTO subscriptions (id, user_id, package_id, status, start_date, end_date)
         VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY))`,
        [subscriptions[index], users[index], packageId]
      );
    }

    const app = express();
    app.use('/api/v1/media', mediaRoutes);
    server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/media`;
    const tokens = users.map((id) => generateToken({ id, email: `${id}@example.test`, role: 'customer' }));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const upload = async (token, bytes, mimeType = 'image/png', filename = 'image.png') => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: mimeType }), filename);
      return fetch(baseUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
    };

    const unauthorized = await fetch(`${baseUrl}/download/${randomUUID()}.png`);
    assert.equal(unauthorized.status, 401);

    const validUpload = await upload(tokens[0], png);
    assert.equal(validUpload.status, 201);
    const uploadBody = await validUpload.json();
    const mediaId = uploadBody.data.media_id;
    const ownerDownload = await fetch(`${baseUrl}/download/${mediaId}`, {
      headers: { authorization: `Bearer ${tokens[0]}` },
    });
    assert.equal(ownerDownload.status, 200);
    assert.deepEqual(Buffer.from(await ownerDownload.arrayBuffer()), png);

    const crossAccountDownload = await fetch(`${baseUrl}/download/${mediaId}`, {
      headers: { authorization: `Bearer ${tokens[1]}` },
    });
    assert.equal(crossAccountDownload.status, 404);
    const missingDownload = await fetch(`${baseUrl}/download/${randomUUID()}.png`, {
      headers: { authorization: `Bearer ${tokens[0]}` },
    });
    assert.equal(missingDownload.status, 404);

    assert.equal((await upload(tokens[0], png, 'text/plain')).status, 400);
    assert.equal((await upload(tokens[0], Buffer.from('not a png'))).status, 400);
    assert.equal((await upload(tokens[0], Buffer.alloc(16 * 1024 * 1024 + 1))).status, 413);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
      if (databaseAvailable) {
        for (const accountId of accounts) await pool.execute('DELETE FROM accounts WHERE id = ?', [accountId]);
        for (const subscriptionId of subscriptions) await pool.execute('DELETE FROM subscriptions WHERE id = ?', [subscriptionId]);
        for (const userId of users) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.execute('DELETE FROM packages WHERE id = ?', [packageId]);
      }
    } finally {
      await pool.end();
      process.chdir(originalCwd);
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
});
