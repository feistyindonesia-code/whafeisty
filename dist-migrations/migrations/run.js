"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const connection_1 = require("../src/services/database/connection");
const migrations = [
    {
        version: '0001',
        name: 'add message usage indexes',
        source: 'messages:idx_messages_outbound_usage(direction,created_at,device_id);idx_messages_contact_usage(device_id,direction,to_number,created_at)',
        async up(connection) {
            await ensureIndex(connection, 'messages', 'idx_messages_outbound_usage', 'direction, created_at, device_id');
            await ensureIndex(connection, 'messages', 'idx_messages_contact_usage', 'device_id, direction, to_number, created_at');
        },
    },
    {
        version: '0002',
        name: 'hash API keys and record key audit events',
        source: 'api_keys:key_prefix,key_hash,revoked_at;legacy_keys_revoked_and_erased;api_key_audit_events',
        async up(connection) {
            await ensureColumn(connection, 'api_keys', 'key_prefix', 'VARCHAR(32) NULL');
            await ensureColumn(connection, 'api_keys', 'key_hash', 'CHAR(64) NULL');
            await ensureColumn(connection, 'api_keys', 'revoked_at', 'TIMESTAMP NULL');
            await ensureLegacyApiKeyPlaintextErased(connection);
            await ensureUniqueIndex(connection, 'api_keys', 'uq_api_keys_prefix', 'key_prefix');
            await connection.query(`
        CREATE TABLE IF NOT EXISTS api_key_audit_events (
          id VARCHAR(36) PRIMARY KEY,
          account_id VARCHAR(36) NOT NULL,
          api_key_id VARCHAR(36) NULL,
          actor_user_id VARCHAR(36) NULL,
          action VARCHAR(32) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_api_key_audit_account_created (account_id, created_at),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
      `);
        },
    },
    {
        version: '0003',
        name: 'add one-time password reset tokens',
        source: 'users:auth_token_version;password_reset_tokens:user_id,token_hash,expires_at,used_at',
        async up(connection) {
            await ensureColumn(connection, 'users', 'auth_token_version', 'INT NOT NULL DEFAULT 0');
            await connection.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL,
          token_hash CHAR(64) NOT NULL UNIQUE,
          expires_at TIMESTAMP NOT NULL,
          used_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_password_reset_user_created (user_id, created_at),
          INDEX idx_password_reset_expiry (expires_at),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
        },
    },
    {
        version: '0004',
        name: 'limit password reset code attempts',
        source: 'password_reset_tokens:attempt_count',
        async up(connection) {
            await ensureColumn(connection, 'password_reset_tokens', 'attempt_count', 'INT NOT NULL DEFAULT 0');
        },
    },
    {
        version: '0005',
        name: 'add admin settings and audit records',
        source: 'platform_settings;admin_audit_logs',
        async up(connection) {
            await connection.query(`
        CREATE TABLE IF NOT EXISTS platform_settings (
          setting_key VARCHAR(100) PRIMARY KEY,
          setting_value VARCHAR(255) NOT NULL,
          updated_by VARCHAR(36) NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
        )
      `);
            await connection.query(`
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
          id VARCHAR(36) PRIMARY KEY,
          actor_user_id VARCHAR(36) NULL,
          action VARCHAR(100) NOT NULL,
          entity_type VARCHAR(50) NOT NULL,
          entity_id VARCHAR(36) NULL,
          details JSON NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_admin_audit_created (created_at),
          INDEX idx_admin_audit_entity (entity_type, entity_id),
          FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);
        },
    },
    {
        version: '0006',
        name: 'add package feature entitlements',
        source: 'packages:features',
        async up(connection) {
            await ensureColumn(connection, 'packages', 'features', 'JSON NULL');
        },
    },
    {
        version: '0007',
        name: 'add customer feature workspaces',
        source: 'crm_contacts;broadcast_campaigns;broadcast_recipients;automation_rules;advertising_campaigns',
        async up(connection) {
            await connection.query(`
        CREATE TABLE IF NOT EXISTS crm_contacts (
          id VARCHAR(36) PRIMARY KEY,
          account_id VARCHAR(36) NOT NULL,
          phone_number VARCHAR(20) NOT NULL,
          name VARCHAR(150) NULL,
          email VARCHAR(255) NULL,
          company VARCHAR(150) NULL,
          tags JSON NULL,
          notes TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_crm_account_phone (account_id, phone_number),
          INDEX idx_crm_account_name (account_id, name),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
      `);
            await connection.query(`
        CREATE TABLE IF NOT EXISTS broadcast_campaigns (
          id VARCHAR(36) PRIMARY KEY,
          account_id VARCHAR(36) NOT NULL,
          device_id VARCHAR(36) NOT NULL,
          name VARCHAR(150) NOT NULL,
          content TEXT NOT NULL,
          status ENUM('draft', 'ready', 'cancelled') NOT NULL DEFAULT 'draft',
          recipient_count INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_broadcast_account_created (account_id, created_at),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        )
      `);
            await connection.query(`
        CREATE TABLE IF NOT EXISTS broadcast_recipients (
          id VARCHAR(36) PRIMARY KEY,
          campaign_id VARCHAR(36) NOT NULL,
          account_id VARCHAR(36) NOT NULL,
          phone_number VARCHAR(20) NOT NULL,
          status ENUM('pending', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
          message_id VARCHAR(36) NULL,
          error_code VARCHAR(100) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_broadcast_campaign_phone (campaign_id, phone_number),
          INDEX idx_broadcast_recipient_pending (status, created_at),
          FOREIGN KEY (campaign_id) REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
      `);
            await connection.query(`
        CREATE TABLE IF NOT EXISTS automation_rules (
          id VARCHAR(36) PRIMARY KEY,
          account_id VARCHAR(36) NOT NULL,
          name VARCHAR(150) NOT NULL,
          trigger_type ENUM('keyword') NOT NULL DEFAULT 'keyword',
          keyword VARCHAR(100) NOT NULL,
          reply_text VARCHAR(2000) NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_automation_account_enabled (account_id, enabled),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
      `);
            await connection.query(`
        CREATE TABLE IF NOT EXISTS advertising_campaigns (
          id VARCHAR(36) PRIMARY KEY,
          account_id VARCHAR(36) NOT NULL,
          name VARCHAR(150) NOT NULL,
          platform ENUM('meta', 'google', 'other') NOT NULL,
          objective VARCHAR(100) NOT NULL,
          landing_url VARCHAR(2048) NULL,
          budget DECIMAL(12,2) NOT NULL DEFAULT 0,
          status ENUM('draft', 'active', 'paused', 'completed') NOT NULL DEFAULT 'draft',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_advertising_account_created (account_id, created_at),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
      `);
        },
    },
];
async function ensureIndex(connection, tableName, indexName, columns) {
    const [rows] = await connection.execute(`SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [tableName, indexName]);
    if (rows.length === 0) {
        await connection.query(`CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${columns})`);
    }
}
async function ensureUniqueIndex(connection, tableName, indexName, columns) {
    const [rows] = await connection.execute(`SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [tableName, indexName]);
    if (rows.length === 0) {
        await connection.query(`CREATE UNIQUE INDEX \`${indexName}\` ON \`${tableName}\` (${columns})`);
    }
}
async function ensureColumn(connection, tableName, columnName, definition) {
    const [rows] = await connection.execute(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [tableName, columnName]);
    if (rows.length === 0) {
        await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
    }
}
async function ensureLegacyApiKeyPlaintextErased(connection) {
    const [columnRows] = await connection.execute(`SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_keys' AND COLUMN_NAME = 'key'`);
    if (columnRows.length === 0) {
        return;
    }
    if (columnRows[0].IS_NULLABLE !== 'YES') {
        await connection.query('ALTER TABLE api_keys MODIFY COLUMN `key` VARCHAR(100) NULL');
    }
    await connection.execute(`UPDATE api_keys
     SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), \`key\` = NULL
     WHERE \`key\` IS NOT NULL`);
    await connection.query('ALTER TABLE api_keys DROP COLUMN `key`');
}
async function runMigrations() {
    let lockConnection;
    let migrationLockAcquired = false;
    try {
        console.log('Running migrations...');
        const connection = await connection_1.pool.getConnection();
        lockConnection = connection;
        const [lockRows] = await connection.query("SELECT GET_LOCK('whafeisty_schema_migrations', 30) AS acquired");
        if (Number(lockRows[0].acquired) !== 1) {
            throw new Error('Could not acquire database migration lock within 30 seconds');
        }
        migrationLockAcquired = true;
        await (0, connection_1.initializeSchema)();
        await connection.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(32) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
        await connection.execute(`INSERT IGNORE INTO schema_migrations (version, name, checksum)
       VALUES (?, ?, ?)`, ['0000', 'legacy schema baseline', (0, crypto_1.createHash)('sha256').update('legacy-schema-baseline-v1').digest('hex')]);
        for (const migration of migrations) {
            const migrationChecksum = (0, crypto_1.createHash)('sha256')
                .update(migration.source)
                .update(migration.up.toString())
                .update(ensureIndex.toString());
            if (migration.version !== '0001') {
                migrationChecksum
                    .update(ensureUniqueIndex.toString())
                    .update(ensureColumn.toString())
                    .update(ensureLegacyApiKeyPlaintextErased.toString());
            }
            const checksum = migrationChecksum.digest('hex');
            const [appliedRows] = await connection.execute('SELECT checksum FROM schema_migrations WHERE version = ?', [migration.version]);
            const applied = appliedRows[0];
            if (applied) {
                if (applied.checksum !== checksum) {
                    throw new Error(`Migration ${migration.version} checksum changed after it was applied`);
                }
                console.log(`Skipping migration ${migration.version}: already applied`);
                continue;
            }
            console.log(`Applying migration ${migration.version}: ${migration.name}`);
            await migration.up(connection);
            await connection.execute('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)', [migration.version, migration.name, checksum]);
        }
        console.log('Migrations completed successfully');
    }
    catch (error) {
        console.error('Migration failed:', error);
        process.exitCode = 1;
    }
    finally {
        if (migrationLockAcquired) {
            if (!lockConnection) {
                console.error('Migration lock was acquired without a database connection');
                process.exitCode = 1;
            }
            else {
                try {
                    await lockConnection.query("SELECT RELEASE_LOCK('whafeisty_schema_migrations')");
                }
                catch (error) {
                    console.error('Failed to release database migration lock:', error);
                    process.exitCode = 1;
                }
            }
        }
        lockConnection?.release();
        await connection_1.pool.end();
    }
    if (process.exitCode) {
        process.exit(process.exitCode);
    }
}
runMigrations();
