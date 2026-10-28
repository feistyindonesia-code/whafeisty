import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const databasePassword = process.env.DB_PASSWORD;
if (!databasePassword) {
  throw new Error('DB_PASSWORD must be configured');
}

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'whatsapp_user',
  password: databasePassword,
  database: process.env.DB_NAME || 'whatsapp_api',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function initializeSchema() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        auth_token_version INT NOT NULL DEFAULT 0,
        role ENUM('customer', 'superadmin') DEFAULT 'customer',
        name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS packages (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        device_limit INT NOT NULL,
        message_limit INT NOT NULL,
        duration_type ENUM('daily', 'weekly', 'monthly', 'yearly') DEFAULT 'monthly',
        duration_value INT DEFAULT 1,
        description TEXT,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        package_id VARCHAR(36) NOT NULL,
        status ENUM('active', 'pending', 'expired', 'suspended') DEFAULT 'pending',
        start_date TIMESTAMP NULL,
        end_date TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        package_id VARCHAR(36) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        method VARCHAR(50),
        status ENUM('pending', 'paid', 'rejected', 'expired') DEFAULT 'pending',
        proof_url TEXT,
        paid_at TIMESTAMP NULL,
        verified_by VARCHAR(36) NULL,
        verified_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        package_id VARCHAR(36) NULL,
        name VARCHAR(100) NOT NULL,
        max_devices INT DEFAULT 5,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id VARCHAR(36) PRIMARY KEY,
        account_id VARCHAR(36) NOT NULL,
        device_id VARCHAR(100) UNIQUE,
        status ENUM('online', 'offline', 'disconnected') DEFAULT 'disconnected',
        connection_status ENUM('connected', 'connecting', 'disconnected') DEFAULT 'disconnected',
        last_seen TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id VARCHAR(36) PRIMARY KEY,
        account_id VARCHAR(36) NOT NULL,
        \`key\` VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(100),
        permissions JSON,
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMP NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(36) PRIMARY KEY,
        from_number VARCHAR(20) NOT NULL,
        to_number VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        media_url TEXT,
        status ENUM('sent', 'delivered', 'read', 'error') DEFAULT 'sent',
        message_id VARCHAR(100) UNIQUE,
        direction ENUM('outbound', 'inbound') DEFAULT 'outbound',
        device_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id VARCHAR(36) PRIMARY KEY,
        device_id VARCHAR(36) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        name VARCHAR(100),
        profile_picture_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
        UNIQUE KEY unique_contact (device_id, phone_number)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS contact_consents (
        id VARCHAR(36) PRIMARY KEY,
        account_id VARCHAR(36) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        status ENUM('opted_in', 'opted_out') NOT NULL,
        purpose VARCHAR(255) NULL,
        consent_source VARCHAR(100) NOT NULL,
        evidence TEXT NOT NULL,
        consented_at TIMESTAMP NULL,
        revoked_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_account_consent_phone (account_id, phone_number),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS contact_consent_events (
        id VARCHAR(36) PRIMARY KEY,
        account_id VARCHAR(36) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        action ENUM('opted_in', 'opted_out') NOT NULL,
        purpose VARCHAR(255) NULL,
        consent_source VARCHAR(100) NOT NULL,
        evidence TEXT NOT NULL,
        recorded_by VARCHAR(36) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX consent_event_history (account_id, phone_number, created_at),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS send_safety_states (
        account_id VARCHAR(36) PRIMARY KEY,
        consecutive_failures INT NOT NULL DEFAULT 0,
        paused_until TIMESTAMP NULL,
        pause_reason VARCHAR(255) NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id VARCHAR(36) PRIMARY KEY,
        account_id VARCHAR(36) NOT NULL,
        url VARCHAR(255) NOT NULL,
        events JSON,
        secret VARCHAR(100),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  } finally {
    connection.release();
  }
}

export async function assertDatabaseSchemaCurrent() {
  try {
    const [migrationRows] = await pool.execute(
      'SELECT version FROM schema_migrations WHERE version IN (?, ?, ?, ?, ?, ?)',
      ['0002', '0003', '0004', '0005', '0006', '0007']
    );
    const appliedVersions = new Set((migrationRows as any[]).map((row) => row.version));
    if (!appliedVersions.has('0002')) {
      throw new Error('required migration 0002 is not recorded');
    }
    if (!appliedVersions.has('0003')) {
      throw new Error('required migration 0003 is not recorded');
    }
    if (!appliedVersions.has('0004')) {
      throw new Error('required migration 0004 is not recorded');
    }
    if (!appliedVersions.has('0005')) {
      throw new Error('required migration 0005 is not recorded');
    }
    if (!appliedVersions.has('0006')) {
      throw new Error('required migration 0006 is not recorded');
    }
    if (!appliedVersions.has('0007')) {
      throw new Error('required migration 0007 is not recorded');
    }

    const [columnRows] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_keys'
         AND COLUMN_NAME IN ('key_prefix', 'key_hash', 'revoked_at')`
    );
    if ((columnRows as any[]).length !== 3) {
      throw new Error('API key hash schema is incomplete');
    }

    const [indexRows] = await pool.execute(
      `SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND
         ((TABLE_NAME = 'api_keys' AND INDEX_NAME = 'uq_api_keys_prefix')
          OR (TABLE_NAME = 'messages' AND INDEX_NAME IN (
            'idx_messages_outbound_usage', 'idx_messages_contact_usage'
          )))`
    );
    if ((indexRows as any[]).length !== 3) {
      throw new Error('Required API key or message usage indexes are missing');
    }

    const [auditRows] = await pool.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_key_audit_events'`
    );
    if ((auditRows as any[]).length !== 1) {
      throw new Error('API key audit schema is missing');
    }

    const [legacyKeyColumns] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_keys' AND COLUMN_NAME = 'key'`
    );
    if ((legacyKeyColumns as any[]).length !== 0) {
      throw new Error('legacy plaintext API key column remains; revoke and remove it before startup');
    }

    const [resetTableRows] = await pool.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'`
    );
    if ((resetTableRows as any[]).length !== 1) {
      throw new Error('password reset schema is missing');
    }
    const [resetAttemptRows] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'
         AND COLUMN_NAME = 'attempt_count'`
    );
    if ((resetAttemptRows as any[]).length !== 1) {
      throw new Error('password reset attempt limit schema is missing');
    }

    const [tokenVersionRows] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
         AND COLUMN_NAME = 'auth_token_version'`
    );
    if ((tokenVersionRows as any[]).length !== 1) {
      throw new Error('user token-version column is missing');
    }
    const [adminTableRows] = await pool.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('platform_settings', 'admin_audit_logs')`
    );
    if ((adminTableRows as any[]).length !== 2) {
      throw new Error('admin settings or audit schema is missing');
    }
    const [packageFeatureRows] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'packages' AND COLUMN_NAME = 'features'`
    );
    if ((packageFeatureRows as any[]).length !== 1) {
      throw new Error('package feature entitlement schema is missing');
    }
    const [featureTableRows] = await pool.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
         'crm_contacts', 'broadcast_campaigns', 'broadcast_recipients',
         'automation_rules', 'advertising_campaigns'
       )`
    );
    if ((featureTableRows as any[]).length !== 5) {
      throw new Error('customer feature workspace schema is incomplete');
    }
  } catch (error) {
    throw new Error(`Database schema is not current or secure. Run the migration command before starting the API: ${String(error)}`);
  }
}
