const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const migrationDatabaseName = process.env.WHAFEISTY_MIGRATION_TEST_DB_NAME;
const allowedName = /^[A-Za-z0-9_]+_test$/;
if (migrationDatabaseName && !allowedName.test(migrationDatabaseName)) {
  throw new Error('WHAFEISTY_MIGRATION_TEST_DB_NAME must be a valid database name ending in "_test"');
}
if (
  migrationDatabaseName &&
  (migrationDatabaseName === process.env.WHAFEISTY_TEST_DB_NAME ||
    migrationDatabaseName === process.env.DB_NAME)
) {
  throw new Error('Migration tests require a dedicated database distinct from application and concurrency test databases');
}

function runMigrationRunner(databaseName) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist-migrations/migrations/run.js'], {
      cwd: process.cwd(),
      env: { ...process.env, DB_NAME: databaseName, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
}

test('MySQL migrations are repeatable, checksummed, serialized, and required at API startup', {
  skip: !migrationDatabaseName || process.env.NODE_ENV === 'production',
}, async (t) => {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD must be set for migration integration tests');
  process.env.DB_NAME = migrationDatabaseName;
  process.env.NODE_ENV = 'test';

  const mysql = require('mysql2/promise');
  let connection;
  let pool;
  let seededLegacyAccountId;
  let seededLegacyUserId;
  let seededLegacyKeyId;

  try {
    try {
      connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'whatsapp_user',
        password: process.env.DB_PASSWORD,
        database: migrationDatabaseName,
      });
    } catch {
      t.skip('Configured MySQL migration test service is unavailable');
      return;
    }
    const [tableRows] = await connection.execute(
      `SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ?`,
      [migrationDatabaseName]
    );
    const hasMigrationTable = (await connection.execute(
      `SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'schema_migrations'`,
      [migrationDatabaseName]
    ))[0][0].count > 0;

    if (Number(tableRows[0].count) > 0 && !hasMigrationTable) {
      throw new Error('Migration test database must be empty or already managed by this migration runner');
    }

    const database = require('../dist/services/database/connection');
    const { assertDatabaseSchemaCurrent } = database;
    pool = database.pool;
    if (Number(tableRows[0].count) === 0) {
      await database.initializeSchema();
    }
    const [legacyColumnRows] = await connection.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'api_keys' AND COLUMN_NAME = 'key'`,
      [migrationDatabaseName]
    );
    const [alreadyAppliedRows] = await connection.execute(
      'SELECT version FROM schema_migrations WHERE version = ?',
      ['0002']
    ).catch((error) => {
      if (error.code === 'ER_NO_SUCH_TABLE') return [[]];
      throw error;
    });
    if (legacyColumnRows.length && !alreadyAppliedRows.length) {
      seededLegacyUserId = require('node:crypto').randomUUID();
      seededLegacyAccountId = require('node:crypto').randomUUID();
      seededLegacyKeyId = require('node:crypto').randomUUID();
      await connection.execute(
        'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
        [seededLegacyUserId, `${seededLegacyUserId}@example.test`, 'test-only-hash', 'customer', 'Legacy key migration test']
      );
      await connection.execute(
        'INSERT INTO accounts (id, user_id, name) VALUES (?, ?, ?)',
        [seededLegacyAccountId, seededLegacyUserId, 'Legacy key migration test']
      );
      await connection.execute(
        'INSERT INTO api_keys (id, account_id, `key`, name, permissions) VALUES (?, ?, ?, ?, ?)',
        [seededLegacyKeyId, seededLegacyAccountId, `legacy-test-${seededLegacyKeyId}`, 'legacy test key', JSON.stringify({})]
      );
    }

    const runners = await Promise.all([
      runMigrationRunner(migrationDatabaseName),
      runMigrationRunner(migrationDatabaseName),
    ]);
    assert.deepEqual(runners.map((result) => result.code), [0, 0]);
    assert.ok(runners.some((result) => result.output.includes('Applying migration 0002') ||
      result.output.includes('Skipping migration 0002')));
    assert.ok(runners.some((result) => result.output.includes('Skipping migration 0002')));

    const [migrationRows] = await connection.execute(
      'SELECT version, checksum FROM schema_migrations WHERE version IN (?, ?, ?, ?, ?, ?)',
      ['0001', '0002', '0003', '0004', '0005', '0006']
    );
    assert.equal(migrationRows.length, 6);
    const migration2 = migrationRows.find((row) => row.version === '0002');
    const migration3 = migrationRows.find((row) => row.version === '0003');
    const migration4 = migrationRows.find((row) => row.version === '0004');
    const migration5 = migrationRows.find((row) => row.version === '0005');
    const migration6 = migrationRows.find((row) => row.version === '0006');
    assert.match(migration2.checksum, /^[a-f0-9]{64}$/);
    assert.match(migration3.checksum, /^[a-f0-9]{64}$/);
    assert.match(migration4.checksum, /^[a-f0-9]{64}$/);
    assert.match(migration5.checksum, /^[a-f0-9]{64}$/);
    assert.match(migration6.checksum, /^[a-f0-9]{64}$/);

    const [requiredIndexes] = await connection.execute(
      `SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'messages'
         AND INDEX_NAME IN ('idx_messages_outbound_usage', 'idx_messages_contact_usage')`,
      [migrationDatabaseName]
    );
    assert.equal(requiredIndexes.length, 2);
    const [keyColumns] = await connection.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'api_keys'
         AND COLUMN_NAME IN ('key_prefix', 'key_hash', 'revoked_at')`,
      [migrationDatabaseName]
    );
    assert.equal(keyColumns.length, 3);
    const [legacyKeyColumn] = await connection.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'api_keys' AND COLUMN_NAME = 'key'`,
      [migrationDatabaseName]
    );
    assert.equal(legacyKeyColumn.length, 0);
    const [resetSchemaRows] = await connection.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'password_reset_tokens'`,
      [migrationDatabaseName]
    );
    assert.equal(resetSchemaRows.length, 1);
    const [tokenVersionRows] = await connection.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'auth_token_version'`,
      [migrationDatabaseName]
    );
    assert.equal(tokenVersionRows.length, 1);
    const [resetAttemptRows] = await connection.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'password_reset_tokens'
         AND COLUMN_NAME = 'attempt_count'`,
      [migrationDatabaseName]
    );
    assert.equal(resetAttemptRows.length, 1);
    const [adminSchemaRows] = await connection.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('platform_settings', 'admin_audit_logs')`,
      [migrationDatabaseName]
    );
    assert.equal(adminSchemaRows.length, 2);
    const [packageFeatureRows] = await connection.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'packages' AND COLUMN_NAME = 'features'`,
      [migrationDatabaseName]
    );
    assert.equal(packageFeatureRows.length, 1);
    let legacyKeyRevoked = false;
    if (seededLegacyKeyId) {
      const [legacyRows] = await connection.execute(
        'SELECT revoked_at, key_prefix, key_hash FROM api_keys WHERE id = ?',
        [seededLegacyKeyId]
      );
      assert.equal(legacyRows.length, 1);
      assert.ok(legacyRows[0].revoked_at);
      assert.equal(legacyRows[0].key_prefix, null);
      assert.equal(legacyRows[0].key_hash, null);
      legacyKeyRevoked = true;
    }

    await assertDatabaseSchemaCurrent();
    try {
      await connection.execute('UPDATE schema_migrations SET checksum = ? WHERE version = ?', ['0'.repeat(64), '0002']);
      const mismatch = await runMigrationRunner(migrationDatabaseName);
      assert.notEqual(mismatch.code, 0);
      assert.match(mismatch.output, /checksum changed after it was applied/);
    } finally {
      await connection.execute('UPDATE schema_migrations SET checksum = ? WHERE version = ?', [migration2.checksum, '0002']);
    }

    try {
      await connection.execute('DELETE FROM schema_migrations WHERE version = ?', ['0002']);
      await assert.rejects(assertDatabaseSchemaCurrent(), /required migration 0002 is not recorded/);
    } finally {
      await connection.execute(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)',
        ['0002', 'hash API keys and record key audit events', migration2.checksum]
      );
    }
    console.log(JSON.stringify({
      test: 'mysql_migration_lifecycle',
      concurrentRunners: runners.length,
      successfulRunners: runners.filter((result) => result.code === 0).length,
      secondRunSkipped: runners.some((result) => result.output.includes('Skipping migration 0002')),
      checksumMismatchRejected: true,
      startupMissingMigrationRejected: true,
      requiredIndexes: requiredIndexes.length,
      legacyPlaintextKeyRevokedAndCleared: legacyKeyRevoked,
    }));
  } finally {
    if (connection && seededLegacyAccountId) {
      await connection.execute('DELETE FROM accounts WHERE id = ?', [seededLegacyAccountId]);
    }
    if (connection && seededLegacyUserId) {
      await connection.execute('DELETE FROM users WHERE id = ?', [seededLegacyUserId]);
    }
    if (pool) await pool.end();
    if (connection) await connection.end();
  }
});
