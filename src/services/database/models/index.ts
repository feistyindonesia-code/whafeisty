import { pool } from '../connection';
import { timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import type { PoolConnection } from 'mysql2/promise';
import {
  apiKeyHashMatches,
  createApiKey,
  normalizeApiKeyScopes,
  parseApiKey,
  type ApiKeyScope,
} from '../../security/api-keys';

export class UserModel {
  static async create(email: string, password: string, role: 'customer' | 'superadmin', name?: string) {
    const id = uuidv4();
    const password_hash = await bcrypt.hash(password, 10);
    await pool.execute(
      'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
      [id, email, password_hash, role, name || null]
    );
    return { id, email, role, name };
  }

  static async createCustomerRegistration(input: {
    name: string;
    email: string;
    password: string;
    packageId: string;
    deviceLimit: number;
  }) {
    const userId = uuidv4();
    const subscriptionId = uuidv4();
    const accountId = uuidv4();
    const passwordHash = await bcrypt.hash(input.password, 10);
    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;
      await connection.execute(
        'INSERT INTO users (id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
        [userId, input.email, passwordHash, 'customer', input.name]
      );
      await connection.execute(
        'INSERT INTO subscriptions (id, user_id, package_id, status) VALUES (?, ?, ?, ?)',
        [subscriptionId, userId, input.packageId, 'pending']
      );
      await connection.execute(
        'INSERT INTO accounts (id, user_id, name, max_devices, package_id) VALUES (?, ?, ?, ?, ?)',
        [accountId, userId, `${input.name}'s Account`, input.deviceLimit, input.packageId]
      );
      await connection.commit();

      return {
        user: { id: userId, email: input.email, role: 'customer' as const, name: input.name },
        subscription: { id: subscriptionId },
        account: { id: accountId },
      };
    } catch (error) {
      if (transactionStarted) {
        await connection.rollback();
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  static async findByEmail(email: string) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    const users = rows as any[];
    return users.length > 0 ? users[0] : null;
  }

  static async findById(id: string) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
    const users = rows as any[];
    return users.length > 0 ? users[0] : null;
  }

  static async verifyPassword(plain: string, hash: string) {
    return bcrypt.compare(plain, hash);
  }

  static async createPasswordReset(email: string, codeHash: string, expiresAt: Date) {
    const connection = await pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const [userRows] = await connection.execute(
        'SELECT id, email FROM users WHERE email = ? FOR UPDATE',
        [email]
      );
      const user = (userRows as any[])[0];
      if (!user) {
        await connection.commit();
        return null;
      }

      const [recentRows] = await connection.execute(
        `SELECT COUNT(*) AS count FROM password_reset_tokens
         WHERE user_id = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)`,
        [user.id]
      );
      if (Number((recentRows as any[])[0].count) >= 3) {
        await connection.commit();
        return null;
      }

      await connection.execute(
        'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL',
        [user.id]
      );
      await connection.execute(
        'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
        [uuidv4(), user.id, codeHash, expiresAt]
      );
      await connection.commit();
      return { id: user.id, email: user.email };
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async completePasswordReset(email: string, codeHash: string, password: string) {
    const connection = await pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const [userRows] = await connection.execute(
        'SELECT id FROM users WHERE email = ? FOR UPDATE',
        [email]
      );
      const user = (userRows as any[])[0];
      if (!user) {
        await connection.rollback();
        transactionStarted = false;
        return false;
      }
      const [resetRows] = await connection.execute(
        `SELECT id, token_hash, expires_at, used_at, attempt_count
         FROM password_reset_tokens
         WHERE user_id = ? AND used_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1 FOR UPDATE`,
        [user.id]
      );
      const resetRequest = (resetRows as any[])[0];
      if (!resetRequest || resetRequest.used_at) {
        await connection.rollback();
        transactionStarted = false;
        return false;
      }

      if (
        new Date(resetRequest.expires_at).getTime() <= Date.now() ||
        Number(resetRequest.attempt_count) >= 5
      ) {
        await connection.execute(
          'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?',
          [resetRequest.id]
        );
        await connection.commit();
        transactionStarted = false;
        return false;
      }

      const expectedHash = Buffer.from(resetRequest.token_hash, 'hex');
      const providedHash = Buffer.from(codeHash, 'hex');
      const codeMatches = expectedHash.length === providedHash.length &&
        timingSafeEqual(expectedHash, providedHash);
      if (!codeMatches) {
        const nextAttempts = Number(resetRequest.attempt_count) + 1;
        await connection.execute(
          `UPDATE password_reset_tokens
           SET attempt_count = ?, used_at = IF(? >= 5, CURRENT_TIMESTAMP, used_at)
           WHERE id = ?`,
          [nextAttempts, nextAttempts, resetRequest.id]
        );
        await connection.commit();
        transactionStarted = false;
        return false;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      await connection.execute(
        'UPDATE users SET password_hash = ?, auth_token_version = auth_token_version + 1 WHERE id = ?',
        [passwordHash, user.id]
      );
      await connection.execute(
        'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL',
        [user.id]
      );
      await connection.commit();
      transactionStarted = false;
      return true;
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async invalidatePasswordReset(codeHash: string) {
    await pool.execute(
      'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND used_at IS NULL',
      [codeHash]
    );
  }
}

export class PackageModel {
  static async create(data: { name: string; price: number; device_limit: number; message_limit: number; duration_type: string; duration_value: number; description?: string; features?: Record<string, boolean> }) {
    const id = uuidv4();
    await pool.execute(
      'INSERT INTO packages (id, name, price, device_limit, message_limit, duration_type, duration_value, description, features) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, data.name, data.price, data.device_limit, data.message_limit, data.duration_type, data.duration_value, data.description || null, JSON.stringify(data.features || {})]
    );
    return { id, ...data, active: true, created_at: new Date(), updated_at: new Date() };
  }

  static async findActive() {
    const [rows] = await pool.execute('SELECT * FROM packages WHERE active = true');
    return rows as any[];
  }

  static async findById(id: string) {
    const [rows] = await pool.execute('SELECT * FROM packages WHERE id = ?', [id]);
    const packages = rows as any[];
    return packages.length > 0 ? packages[0] : null;
  }

  static async findAll() {
    const [rows] = await pool.execute('SELECT * FROM packages');
    return rows as any[];
  }

  static async update(id: string, data: { name?: string; price?: number; device_limit?: number; message_limit?: number; duration_type?: string; duration_value?: number; description?: string; active?: boolean; features?: Record<string, boolean> }) {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name); }
    if (data.price !== undefined) { updates.push('price = ?'); values.push(data.price); }
    if (data.device_limit !== undefined) { updates.push('device_limit = ?'); values.push(data.device_limit); }
    if (data.message_limit !== undefined) { updates.push('message_limit = ?'); values.push(data.message_limit); }
    if (data.duration_type !== undefined) { updates.push('duration_type = ?'); values.push(data.duration_type); }
    if (data.duration_value !== undefined) { updates.push('duration_value = ?'); values.push(data.duration_value); }
    if (data.description !== undefined) { updates.push('description = ?'); values.push(data.description); }
    if (data.active !== undefined) { updates.push('active = ?'); values.push(data.active); }
    if (data.features !== undefined) { updates.push('features = ?'); values.push(JSON.stringify(data.features)); }

    if (updates.length > 0) {
      values.push(id);
      await pool.execute(`UPDATE packages SET ${updates.join(', ')} WHERE id = ?`, values);
    }
  }

  static async delete(id: string) {
    await pool.execute('DELETE FROM packages WHERE id = ?', [id]);
  }
}

export class SubscriptionModel {
  static async create(userId: string, packageId: string) {
    const id = uuidv4();
    await pool.execute(
      'INSERT INTO subscriptions (id, user_id, package_id, status) VALUES (?, ?, ?, ?)',
      [id, userId, packageId, 'pending']
    );
    return { id, user_id: userId, package_id: packageId, status: 'pending', created_at: new Date(), updated_at: new Date() };
  }

  static async findActiveByUserId(userId: string) {
    const [rows] = await pool.execute(
      "SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' AND (end_date IS NULL OR end_date > CURRENT_TIMESTAMP) ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    const subscriptions = rows as any[];
    return subscriptions.length > 0 ? subscriptions[0] : null;
  }

  static async findActivePackageByUserId(userId: string) {
    const [rows] = await pool.execute(
      `SELECT p.* FROM subscriptions s
       JOIN packages p ON p.id = s.package_id
       WHERE s.user_id = ? AND s.status = 'active'
         AND (s.end_date IS NULL OR s.end_date > CURRENT_TIMESTAMP)
       ORDER BY s.created_at DESC LIMIT 1`,
      [userId]
    );
    const packages = rows as any[];
    const pkg = packages[0] || null;
    if (pkg && typeof pkg.features === 'string') {
      pkg.features = JSON.parse(pkg.features);
    }
    return pkg;
  }

  static async findByUserId(userId: string) {
    const [rows] = await pool.execute(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows as any[];
  }

  static async findById(id: string) {
    const [rows] = await pool.execute('SELECT * FROM subscriptions WHERE id = ?', [id]);
    const subscriptions = rows as any[];
    return subscriptions.length > 0 ? subscriptions[0] : null;
  }

  static async findPendingByUserAndPackage(userId: string, packageId: string) {
    const [rows] = await pool.execute(
      "SELECT * FROM subscriptions WHERE user_id = ? AND package_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      [userId, packageId]
    );
    const subscriptions = rows as any[];
    return subscriptions.length > 0 ? subscriptions[0] : null;
  }

  static async calculateEndDate(startDate: Date, durationType: string, durationValue: number): Promise<Date> {
    const endDate = new Date(startDate);
    switch (durationType) {
      case 'daily':
        endDate.setDate(endDate.getDate() + durationValue);
        break;
      case 'weekly':
        endDate.setDate(endDate.getDate() + (durationValue * 7));
        break;
      case 'monthly':
        endDate.setMonth(endDate.getMonth() + durationValue);
        break;
      case 'yearly':
        endDate.setFullYear(endDate.getFullYear() + durationValue);
        break;
      default:
        endDate.setMonth(endDate.getMonth() + 1);
    }
    return endDate;
  }

  static async updateStatus(id: string, status: 'active' | 'pending' | 'expired' | 'suspended', startDate?: Date, endDate?: Date) {
    let result;
    if (startDate && endDate) {
      [result] = await pool.execute(
        "UPDATE subscriptions SET status = ?, start_date = ?, end_date = ? WHERE id = ? AND status = 'pending'",
        [status, startDate, endDate, id]
      );
    } else {
      [result] = await pool.execute(
        "UPDATE subscriptions SET status = ? WHERE id = ? AND status = 'pending'",
        [status, id]
      );
    }
    return (result as any).affectedRows > 0;
  }

  static async findPending() {
    const [rows] = await pool.execute(
      `SELECT s.*, u.email, u.name, p.name as package_name, p.price,
        EXISTS(
          SELECT 1 FROM payments pm
          WHERE pm.user_id = s.user_id AND pm.package_id = s.package_id AND pm.status = 'paid'
        ) AS payment_verified,
        EXISTS(
          SELECT 1 FROM payments pm
          WHERE pm.user_id = s.user_id AND pm.package_id = s.package_id AND pm.status = 'pending'
        ) AS has_pending_payment
      FROM subscriptions s
      JOIN users u ON s.user_id = u.id
      JOIN packages p ON s.package_id = p.id
      WHERE s.status = 'pending'
      ORDER BY s.created_at DESC`
    );
    return rows as any[];
  }
}

export class PaymentModel {
  static async create(userId: string, packageId: string, amount: number, method?: string, proofUrl?: string) {
    const id = uuidv4();
    await pool.execute(
      'INSERT INTO payments (id, user_id, package_id, amount, method, proof_url) VALUES (?, ?, ?, ?, ?, ?)',
      [id, userId, packageId, amount, method || null, proofUrl || null]
    );
    return { id, user_id: userId, package_id: packageId, amount, method, proof_url: proofUrl, status: 'pending', created_at: new Date() };
  }

  static async findPending() {
    const [rows] = await pool.execute(
      "SELECT p.*, u.email, u.name, pk.name as package_name FROM payments p JOIN users u ON p.user_id = u.id JOIN packages pk ON p.package_id = pk.id WHERE p.status = 'pending' ORDER BY p.created_at DESC"
    );
    return rows as any[];
  }

  static async findByUserId(userId: string) {
    const [rows] = await pool.execute(
      'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows as any[];
  }

  static async updateStatus(id: string, status: 'paid' | 'rejected' | 'expired', verifiedBy?: string) {
    const paidAt = status === 'paid' ? new Date() : null;
    const verifiedAt = status === 'paid' || status === 'rejected' ? new Date() : null;
    const [result] = await pool.execute(
      "UPDATE payments SET status = ?, paid_at = ?, verified_by = ?, verified_at = ? WHERE id = ? AND status = 'pending'",
      [status, paidAt, verifiedBy || null, verifiedAt, id]
    );
    return (result as any).affectedRows > 0;
  }

  static async approveAndActivateSubscription(id: string, verifiedBy: string) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [paymentRows] = await connection.execute(
        'SELECT * FROM payments WHERE id = ? FOR UPDATE',
        [id]
      );
      const payment = (paymentRows as any[])[0];
      if (!payment) {
        await connection.rollback();
        return 'not_found' as const;
      }
      if (payment.status !== 'pending') {
        await connection.rollback();
        return 'already_processed' as const;
      }

      const [subscriptionRows] = await connection.execute(
        "SELECT * FROM subscriptions WHERE user_id = ? AND package_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        [payment.user_id, payment.package_id]
      );
      const subscription = (subscriptionRows as any[])[0];
      if (!subscription) {
        await connection.rollback();
        return 'subscription_not_found' as const;
      }

      const [packageRows] = await connection.execute(
        'SELECT duration_type, duration_value FROM packages WHERE id = ?',
        [payment.package_id]
      );
      const pkg = (packageRows as any[])[0];
      if (!pkg) {
        await connection.rollback();
        return 'package_not_found' as const;
      }

      const startDate = new Date();
      const endDate = await SubscriptionModel.calculateEndDate(startDate, pkg.duration_type, pkg.duration_value);
      await connection.execute(
        'UPDATE payments SET status = ?, paid_at = ?, verified_by = ?, verified_at = ? WHERE id = ?',
        ['paid', startDate, verifiedBy, startDate, id]
      );
      await connection.execute(
        "UPDATE subscriptions SET status = 'active', start_date = ?, end_date = ? WHERE id = ?",
        [startDate, endDate, subscription.id]
      );
      await connection.commit();
      return 'approved' as const;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async findById(id: string) {
    const [rows] = await pool.execute('SELECT * FROM payments WHERE id = ?', [id]);
    const payments = rows as any[];
    return payments.length > 0 ? payments[0] : null;
  }
}

export class AccountModel {
  static async create(userId: string, name: string, maxDevices: number = 5, packageId?: string) {
    const id = uuidv4();
    await pool.execute(
      'INSERT INTO accounts (id, user_id, name, max_devices, package_id) VALUES (?, ?, ?, ?, ?)',
      [id, userId, name, maxDevices, packageId || null]
    );
    return { id, user_id: userId, package_id: packageId, name, max_devices: maxDevices, created_at: new Date(), updated_at: new Date() };
  }

  static async findById(id: string) {
    const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
    const accounts = rows as any[];
    return accounts.length > 0 ? accounts[0] : null;
  }

  static async findByUserId(userId: string) {
    const [rows] = await pool.execute('SELECT * FROM accounts WHERE user_id = ?', [userId]);
    return rows as any[];
  }

  static async updateMaxDevices(id: string, maxDevices: number) {
    await pool.execute('UPDATE accounts SET max_devices = ? WHERE id = ?', [maxDevices, id]);
  }
}

export class DeviceModel {
  static async create(accountId: string) {
    const id = uuidv4();
    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      const [accountRows] = await connection.execute(
        'SELECT id, user_id FROM accounts WHERE id = ? FOR UPDATE',
        [accountId]
      );
      const account = (accountRows as any[])[0];
      if (!account) {
        throw new Error('Account not found');
      }

      const [subscriptionRows] = await connection.execute(
        `SELECT package_id FROM subscriptions
         WHERE user_id = ? AND status = 'active'
           AND (end_date IS NULL OR end_date > CURRENT_TIMESTAMP)
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [account.user_id]
      );
      const subscription = (subscriptionRows as any[])[0];
      if (!subscription) {
        throw new Error('No active subscription');
      }

      const [packageRows] = await connection.execute(
        'SELECT device_limit FROM packages WHERE id = ? FOR UPDATE',
        [subscription.package_id]
      );
      const pkg = (packageRows as any[])[0];
      if (!pkg) {
        throw new Error('Active package not found');
      }

      const [countRows] = await connection.execute(
        'SELECT COUNT(*) AS count FROM devices WHERE account_id = ?',
        [accountId]
      );
      const deviceCount = Number((countRows as any[])[0].count);
      const deviceLimit = Number(pkg.device_limit);
      if (deviceCount >= deviceLimit) {
        throw new DeviceLimitReachedError(deviceLimit);
      }

      await connection.execute(
        'INSERT INTO devices (id, account_id, status, connection_status) VALUES (?, ?, ?, ?)',
        [id, accountId, 'disconnected', 'disconnected']
      );
      await connection.commit();

      return {
        id,
        account_id: accountId,
        device_id: '',
        status: 'disconnected' as const,
        connection_status: 'disconnected' as const,
        last_seen: null,
        created_at: new Date(),
      };
    } catch (error) {
      if (transactionStarted) {
        await connection.rollback();
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  static async findById(id: string) {
    const [rows] = await pool.execute('SELECT * FROM devices WHERE id = ?', [id]);
    const devices = rows as any[];
    return devices.length > 0 ? devices[0] : null;
  }

  static async findAll() {
    const [rows] = await pool.execute('SELECT * FROM devices ORDER BY created_at ASC');
    return rows as any[];
  }

  static async findByAccountId(accountId: string) {
    const [rows] = await pool.execute('SELECT * FROM devices WHERE account_id = ?', [accountId]);
    return rows as any[];
  }

  static async updateStatus(id: string, status: string, connectionStatus: string) {
    await pool.execute(
      'UPDATE devices SET status = ?, connection_status = ?, last_seen = ? WHERE id = ?',
      [status, connectionStatus, new Date(), id]
    );
  }

  static async updateDeviceId(id: string, deviceId: string) {
    await pool.execute('UPDATE devices SET device_id = ? WHERE id = ?', [deviceId, id]);
  }

  static async delete(id: string) {
    await pool.execute('DELETE FROM devices WHERE id = ?', [id]);
  }

  static async countByAccountId(accountId: string) {
    const [rows] = await pool.execute('SELECT COUNT(*) as count FROM devices WHERE account_id = ?', [accountId]);
    const result = rows as any[];
    return result[0].count;
  }
}

export class DeviceLimitReachedError extends Error {
  constructor(public readonly limit: number) {
    super(`Device limit reached (${limit})`);
    this.name = 'DeviceLimitReachedError';
  }
}

export class NoActiveMessageSubscriptionError extends Error {
  constructor() {
    super('No active subscription');
    this.name = 'NoActiveMessageSubscriptionError';
  }
}

export class ApiKeyModel {
  private static readonly lastUsedTouches = new Map<string, number>();
  private static readonly publicColumns = `
    id, account_id, key_prefix, name, permissions, expires_at,
    revoked_at, created_at, last_used
  `;

  static async create(input: {
    accountId: string;
    actorUserId: string;
    name: string;
    scopes: ApiKeyScope[];
    expiresAt: Date | null;
  }) {
    const key = createApiKey();
    const id = uuidv4();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO api_keys
          (id, account_id, key_prefix, key_hash, name, permissions, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, input.accountId, key.keyPrefix, key.keyHash, input.name, JSON.stringify(input.scopes), input.expiresAt]
      );
      await this.writeAudit(connection, input.accountId, id, input.actorUserId, 'created');
      await connection.commit();
      return {
        key: { id, account_id: input.accountId, key_prefix: key.keyPrefix, name: input.name,
          permissions: input.scopes, expires_at: input.expiresAt, revoked_at: null,
          created_at: new Date(), last_used: null },
        secret: key.token,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async findPresentedKey(token: string) {
    const parsed = parseApiKey(token);
    if (!parsed) {
      return { key: null, reason: 'invalid' as const };
    }
    const [rows] = await pool.execute(
      `SELECT id, account_id, key_prefix, key_hash, name, permissions, expires_at, revoked_at
       FROM api_keys WHERE key_prefix = ? LIMIT 1`,
      [parsed.keyPrefix]
    );
    const key = (rows as any[])[0];
    if (!key || !apiKeyHashMatches(key.key_hash, parsed.keyHash) || key.revoked_at) {
      return { key: null, reason: 'invalid' as const };
    }
    if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
      return { key: null, reason: 'expired' as const };
    }
    const [accountRows] = await pool.execute(
      'SELECT user_id FROM accounts WHERE id = ?',
      [key.account_id]
    );
    const account = (accountRows as any[])[0];
    if (!account) {
      return { key: null, reason: 'invalid' as const };
    }
    const permissions = normalizeApiKeyScopes(
      typeof key.permissions === 'string' ? JSON.parse(key.permissions) : key.permissions
    );
    if (!permissions) {
      return { key: null, reason: 'invalid' as const };
    }
    return {
      key: {
        id: key.id,
        account_id: key.account_id,
        user_id: account.user_id,
        key_prefix: key.key_prefix,
        name: key.name,
        permissions,
        expires_at: key.expires_at,
      },
      reason: null,
    };
  }

  static async findByAccountId(accountId: string) {
    const [rows] = await pool.execute(
      `SELECT ${this.publicColumns} FROM api_keys WHERE account_id = ? ORDER BY created_at DESC`,
      [accountId]
    );
    return (rows as any[]).map((row) => ({
      ...row,
      permissions: this.parseStoredScopes(row.permissions),
    }));
  }

  static async rotate(input: {
    accountId: string;
    actorUserId: string;
    id: string;
    name?: string;
    scopes?: ApiKeyScope[];
    expiresAt?: Date | null;
  }) {
    const connection = await pool.getConnection();
    const nextKey = createApiKey();
    const nextId = uuidv4();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT name, permissions, expires_at FROM api_keys
         WHERE id = ? AND account_id = ? AND revoked_at IS NULL FOR UPDATE`,
        [input.id, input.accountId]
      );
      const current = (rows as any[])[0];
      if (!current) {
        await connection.rollback();
        return null;
      }
      const scopes = input.scopes || this.parseStoredScopes(current.permissions);
      const expiresAt = input.expiresAt === undefined ? current.expires_at : input.expiresAt;
      const name = input.name || current.name;
      await connection.execute(
        'UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?',
        [input.id]
      );
      await connection.execute(
        `INSERT INTO api_keys
          (id, account_id, key_prefix, key_hash, name, permissions, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nextId, input.accountId, nextKey.keyPrefix, nextKey.keyHash, name, JSON.stringify(scopes), expiresAt]
      );
      await this.writeAudit(connection, input.accountId, input.id, input.actorUserId, 'rotated');
      await this.writeAudit(connection, input.accountId, nextId, input.actorUserId, 'created');
      await connection.commit();
      return {
        key: { id: nextId, account_id: input.accountId, key_prefix: nextKey.keyPrefix,
          name, permissions: scopes, expires_at: expiresAt, revoked_at: null,
          created_at: new Date(), last_used: null },
        secret: nextKey.token,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async update(input: {
    accountId: string;
    actorUserId: string;
    id: string;
    name?: string;
    scopes?: ApiKeyScope[];
    expiresAt?: Date | null;
  }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT name, permissions, expires_at FROM api_keys
         WHERE id = ? AND account_id = ? AND revoked_at IS NULL FOR UPDATE`,
        [input.id, input.accountId]
      );
      const current = (rows as any[])[0];
      if (!current) {
        await connection.rollback();
        return null;
      }
      await connection.execute(
        `UPDATE api_keys SET name = ?, permissions = ?, expires_at = ? WHERE id = ?`,
        [
          input.name || current.name,
          JSON.stringify(input.scopes || this.parseStoredScopes(current.permissions)),
          input.expiresAt === undefined ? current.expires_at : input.expiresAt,
          input.id,
        ]
      );
      await this.writeAudit(connection, input.accountId, input.id, input.actorUserId, 'updated');
      await connection.commit();
      const [updatedRows] = await pool.execute(
        `SELECT ${this.publicColumns} FROM api_keys WHERE id = ?`,
        [input.id]
      );
      const updated = (updatedRows as any[])[0];
      return { ...updated, permissions: this.parseStoredScopes(updated.permissions) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async revoke(input: { accountId: string; actorUserId: string; id: string }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        `UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP
         WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
        [input.id, input.accountId]
      );
      if ((result as any).affectedRows === 1) {
        await this.writeAudit(connection, input.accountId, input.id, input.actorUserId, 'revoked');
      }
      await connection.commit();
      return (result as any).affectedRows === 1;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async touchLastUsedIfStale(id: string) {
    const now = Date.now();
    const lastTouch = this.lastUsedTouches.get(id) || 0;
    if (now - lastTouch < 5 * 60 * 1000) {
      return;
    }
    await pool.execute(
      `UPDATE api_keys SET last_used = CURRENT_TIMESTAMP
       WHERE id = ? AND (last_used IS NULL OR last_used < CURRENT_TIMESTAMP - INTERVAL 5 MINUTE)`,
      [id]
    );
    this.lastUsedTouches.set(id, now);
    if (this.lastUsedTouches.size > 5000) {
      for (const [keyId, touchedAt] of this.lastUsedTouches) {
        if (now - touchedAt >= 5 * 60 * 1000) this.lastUsedTouches.delete(keyId);
      }
    }
  }

  private static parseStoredScopes(value: unknown): ApiKeyScope[] {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return normalizeApiKeyScopes(parsed) || [];
  }

  private static async writeAudit(
    connection: PoolConnection,
    accountId: string,
    keyId: string,
    actorUserId: string,
    action: string
  ) {
    await connection.execute(
      `INSERT INTO api_key_audit_events (id, account_id, api_key_id, actor_user_id, action)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), accountId, keyId, actorUserId, action]
    );
  }
}

export class MessageModel {
  static async create(message: {
    from_number: string;
    to_number: string;
    content: string;
    media_url?: string;
    status: string;
    message_id: string | null;
    direction: string;
    device_id: string;
  }, connection?: PoolConnection) {
    const id = uuidv4();
    await (connection || pool).execute(
      'INSERT INTO messages (id, from_number, to_number, content, media_url, status, message_id, direction, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, message.from_number, message.to_number, message.content, message.media_url || null, message.status, message.message_id, message.direction, message.device_id]
    );
    return { ...message, id, created_at: new Date() };
  }

  static async findByDeviceId(deviceId: string, limit: number = 50, offset: number = 0) {
    const [rows] = await pool.execute(
      'SELECT * FROM messages WHERE device_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [deviceId, limit, offset]
    );
    return rows as any[];
  }

  static async countOutboundByUserSince(userId: string, since: Date) {
    const [rows] = await pool.execute(
      "SELECT COUNT(*) AS count FROM messages m JOIN devices d ON d.id = m.device_id JOIN accounts a ON a.id = d.account_id WHERE a.user_id = ? AND m.direction = 'outbound' AND m.created_at >= ?",
      [userId, since]
    );
    return Number((rows as any[])[0].count);
  }

  static async withAtomicMonthlyQuota<T>(
    userId: string,
    operation: (
      packageInfo: { package_id: string; message_limit: number },
      connection: PoolConnection
    ) => Promise<T>
  ): Promise<{ quotaExceeded: boolean; result?: T }> {
    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      const [userRows] = await connection.execute(
        'SELECT id FROM users WHERE id = ? FOR UPDATE',
        [userId]
      );
      if ((userRows as any[]).length === 0) {
        throw new Error('User not found');
      }

      const [subscriptionRows] = await connection.execute(
        `SELECT s.package_id, p.message_limit
         FROM subscriptions s
         JOIN packages p ON p.id = s.package_id
         WHERE s.user_id = ? AND s.status = 'active'
           AND (s.end_date IS NULL OR s.end_date > CURRENT_TIMESTAMP)
         ORDER BY s.created_at DESC
         LIMIT 1 FOR UPDATE`,
        [userId]
      );
      const subscription = (subscriptionRows as any[])[0];
      if (!subscription) {
        throw new NoActiveMessageSubscriptionError();
      }

      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [usageRows] = await connection.execute(
        `SELECT COUNT(*) AS count
         FROM messages m
         JOIN devices d ON d.id = m.device_id
         JOIN accounts a ON a.id = d.account_id
         WHERE a.user_id = ? AND m.direction = 'outbound' AND m.created_at >= ?`,
        [userId, monthStart]
      );
      const used = Number((usageRows as any[])[0].count);
      const limit = Number(subscription.message_limit);

      if (limit > 0 && used >= limit) {
        await connection.commit();
        return { quotaExceeded: true };
      }

      const result = await operation({
        package_id: subscription.package_id,
        message_limit: limit,
      }, connection);
      await connection.commit();
      return { quotaExceeded: false, result };
    } catch (error) {
      if (transactionStarted) {
        await connection.rollback();
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  static async countOutboundToContactSince(accountId: string, phoneNumber: string, since: Date) {
    const [rows] = await pool.execute(
      "SELECT COUNT(*) AS count FROM messages m JOIN devices d ON d.id = m.device_id WHERE d.account_id = ? AND m.to_number = ? AND m.direction = 'outbound' AND m.created_at >= ?",
      [accountId, phoneNumber, since]
    );
    return Number((rows as any[])[0].count);
  }

  static async findById(id: string) {
    const [rows] = await pool.execute('SELECT * FROM messages WHERE id = ?', [id]);
    const messages = rows as any[];
    return messages.length > 0 ? messages[0] : null;
  }

  static async updateStatus(messageId: string, status: string) {
    await pool.execute('UPDATE messages SET status = ? WHERE message_id = ?', [status, messageId]);
  }

  static async updateOutboundStatus(id: string, status: 'sent' | 'error', messageId: string | null, connection?: PoolConnection) {
    const [result] = await (connection || pool).execute(
      'UPDATE messages SET status = ?, message_id = ? WHERE id = ? AND direction = ?',
      [status, messageId, id, 'outbound']
    );
    if ((result as any).affectedRows !== 1) {
      throw new Error('Outbound message history update did not affect exactly one row');
    }
  }
}

export class ContactConsentModel {
    static async findByAccountAndPhone(accountId: string, phoneNumber: string) {
      const [rows] = await pool.execute(
        'SELECT * FROM contact_consents WHERE account_id = ? AND phone_number = ?',
        [accountId, phoneNumber]
      );
      const consents = rows as any[];
      return consents.length > 0 ? consents[0] : null;
    }

    static async findByAccount(accountId: string) {
      const [rows] = await pool.execute(
        'SELECT * FROM contact_consents WHERE account_id = ? ORDER BY updated_at DESC',
        [accountId]
      );
      return rows as any[];
    }

    static async findEvents(accountId: string, phoneNumber: string) {
      const [rows] = await pool.execute(
        'SELECT action, purpose, consent_source, evidence, created_at FROM contact_consent_events WHERE account_id = ? AND phone_number = ? ORDER BY created_at DESC',
        [accountId, phoneNumber]
      );
      return rows as any[];
    }

    static async recordConsent(input: {
      accountId: string;
      phoneNumber: string;
      purpose: string;
      source: string;
      evidence: string;
      recordedBy: string;
    }) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [ownerRows] = await connection.execute(
          `SELECT u.id FROM users u
           JOIN accounts a ON a.user_id = u.id
           WHERE a.id = ? FOR UPDATE`,
          [input.accountId]
        );
        if ((ownerRows as any[]).length === 0) {
          throw new Error('Account not found');
        }
        await connection.execute(
          `INSERT INTO contact_consents
            (id, account_id, phone_number, status, purpose, consent_source, evidence, consented_at, revoked_at)
           VALUES (?, ?, ?, 'opted_in', ?, ?, ?, CURRENT_TIMESTAMP, NULL)
           ON DUPLICATE KEY UPDATE
            status = 'opted_in', purpose = VALUES(purpose), consent_source = VALUES(consent_source),
            evidence = VALUES(evidence), consented_at = CURRENT_TIMESTAMP, revoked_at = NULL`,
          [uuidv4(), input.accountId, input.phoneNumber, input.purpose, input.source, input.evidence]
        );
        await connection.execute(
          `INSERT INTO contact_consent_events
            (id, account_id, phone_number, action, purpose, consent_source, evidence, recorded_by)
           VALUES (?, ?, ?, 'opted_in', ?, ?, ?, ?)`,
          [uuidv4(), input.accountId, input.phoneNumber, input.purpose, input.source, input.evidence, input.recordedBy]
        );
        const [rows] = await connection.execute(
          'SELECT * FROM contact_consents WHERE account_id = ? AND phone_number = ?',
          [input.accountId, input.phoneNumber]
        );
        await connection.commit();
        return (rows as any[])[0];
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    static async revokeConsent(input: {
      accountId: string;
      phoneNumber: string;
      source: string;
      evidence: string;
      recordedBy?: string;
    }) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [ownerRows] = await connection.execute(
          `SELECT u.id FROM users u
           JOIN accounts a ON a.user_id = u.id
           WHERE a.id = ? FOR UPDATE`,
          [input.accountId]
        );
        if ((ownerRows as any[]).length === 0) {
          throw new Error('Account not found');
        }
        await connection.execute(
          `INSERT INTO contact_consents
            (id, account_id, phone_number, status, consent_source, evidence, consented_at, revoked_at)
           VALUES (?, ?, ?, 'opted_out', ?, ?, NULL, CURRENT_TIMESTAMP)
           ON DUPLICATE KEY UPDATE
            status = 'opted_out', consent_source = VALUES(consent_source),
            evidence = VALUES(evidence), revoked_at = CURRENT_TIMESTAMP`,
          [uuidv4(), input.accountId, input.phoneNumber, input.source, input.evidence]
        );
        await connection.execute(
          `INSERT INTO contact_consent_events
            (id, account_id, phone_number, action, consent_source, evidence, recorded_by)
           VALUES (?, ?, ?, 'opted_out', ?, ?, ?)`,
          [uuidv4(), input.accountId, input.phoneNumber, input.source, input.evidence, input.recordedBy || null]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  }

export class SendSafetyModel {
    static async findByAccountId(accountId: string, connection?: PoolConnection) {
      const executor = connection || pool;
      if (connection) {
        await connection.execute(
          'INSERT IGNORE INTO send_safety_states (account_id) VALUES (?)',
          [accountId]
        );
      }
      const [rows] = await executor.execute(
        `SELECT * FROM send_safety_states WHERE account_id = ?${connection ? ' FOR UPDATE' : ''}`,
        [accountId]
      );
      const states = rows as any[];
      return states[0] || {
        account_id: accountId,
        consecutive_failures: 0,
        paused_until: null,
        pause_reason: null,
      };
    }

    static async recordFailure(accountId: string, failureThreshold: number, pauseMinutes: number) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [ownerRows] = await connection.execute(
          `SELECT u.id FROM users u
           JOIN accounts a ON a.user_id = u.id
           WHERE a.id = ? FOR UPDATE`,
          [accountId]
        );
        if ((ownerRows as any[]).length === 0) {
          throw new Error('Account not found while recording send failure');
        }
        await connection.execute(
          'INSERT IGNORE INTO send_safety_states (account_id) VALUES (?)',
          [accountId]
        );
        const [rows] = await connection.execute(
          'SELECT * FROM send_safety_states WHERE account_id = ? FOR UPDATE',
          [accountId]
        );
        const current = (rows as any[])[0];
        const failures = Number(current.consecutive_failures) + 1;
        const pauseUntil = failures >= failureThreshold
          ? new Date(Date.now() + pauseMinutes * 60 * 1000)
          : current.paused_until;
        await connection.execute(
          `UPDATE send_safety_states
           SET consecutive_failures = ?, paused_until = ?, pause_reason = ?
           WHERE account_id = ?`,
          [
            failures,
            pauseUntil,
            failures >= failureThreshold ? `Paused after ${failures} consecutive provider failures` : current.pause_reason,
            accountId,
          ]
        );
        await connection.commit();
        return { consecutive_failures: failures, paused_until: pauseUntil };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    static async recordSuccess(accountId: string, connection?: PoolConnection) {
      await (connection || pool).execute(
        `INSERT INTO send_safety_states (account_id, consecutive_failures, paused_until, pause_reason)
         VALUES (?, 0, NULL, NULL)
         ON DUPLICATE KEY UPDATE consecutive_failures = 0, paused_until = NULL, pause_reason = NULL`,
        [accountId]
      );
    }

    static async resume(accountId: string) {
      await pool.execute(
        `INSERT INTO send_safety_states (account_id, consecutive_failures, paused_until, pause_reason)
         VALUES (?, 0, NULL, NULL)
         ON DUPLICATE KEY UPDATE consecutive_failures = 0, paused_until = NULL, pause_reason = NULL`,
        [accountId]
      );
    }
  }

export class ContactModel {
  static async create(contact: any) {
    const id = uuidv4();
    await pool.execute(
      'INSERT INTO contacts (id, device_id, phone_number, name, profile_picture_url) VALUES (?, ?, ?, ?, ?)',
      [id, contact.device_id, contact.phone_number, contact.name || null, contact.profile_picture_url || null]
    );
    return { ...contact, id, created_at: new Date() };
  }

  static async findByDeviceId(deviceId: string) {
    const [rows] = await pool.execute('SELECT * FROM contacts WHERE device_id = ?', [deviceId]);
    return rows as any[];
  }

  static async findByDeviceIdAndPhone(deviceId: string, phoneNumber: string) {
    const [rows] = await pool.execute(
      'SELECT * FROM contacts WHERE device_id = ? AND phone_number = ?',
      [deviceId, phoneNumber]
    );
    const contacts = rows as any[];
    return contacts.length > 0 ? contacts[0] : null;
  }
}

export class WebhookModel {
  static async create(accountId: string, url: string, events: string[], secret?: string) {
    const id = uuidv4();
    await pool.execute(
      'INSERT INTO webhooks (id, account_id, url, events, secret) VALUES (?, ?, ?, ?, ?)',
      [id, accountId, url, JSON.stringify(events), secret || null]
    );
    return { id, account_id: accountId, url, events, secret, active: true, created_at: new Date(), updated_at: new Date() };
  }

  static async findByAccountId(accountId: string) {
    const [rows] = await pool.execute('SELECT * FROM webhooks WHERE account_id = ?', [accountId]);
    return rows as any[];
  }

  static async findById(id: string) {
    const [rows] = await pool.execute('SELECT * FROM webhooks WHERE id = ?', [id]);
    const webhooks = rows as any[];
    return webhooks.length > 0 ? webhooks[0] : null;
  }

  static async update(id: string, url?: string, events?: string[], secret?: string) {
    const updates: string[] = [];
    const values: any[] = [];

    if (url) { updates.push('url = ?'); values.push(url); }
    if (events) { updates.push('events = ?'); values.push(JSON.stringify(events)); }
    if (secret !== undefined) { updates.push('secret = ?'); values.push(secret); }

    if (updates.length > 0) {
      values.push(id);
      await pool.execute(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`, values);
    }
  }

  static async delete(id: string) {
    await pool.execute('DELETE FROM webhooks WHERE id = ?', [id]);
  }
}

const platformSettingDefaults: Record<string, string> = {
  contact_daily_message_limit: process.env.CONTACT_DAILY_MESSAGE_LIMIT || '10',
  contact_weekly_message_limit: process.env.CONTACT_WEEKLY_MESSAGE_LIMIT || '30',
  send_failure_pause_threshold: process.env.SEND_FAILURE_PAUSE_THRESHOLD || '5',
  send_failure_pause_minutes: process.env.SEND_FAILURE_PAUSE_MINUTES || '60',
  customer_registration_enabled: 'true',
};

export class PlatformSettingsModel {
  static async getAll() {
    const [rows] = await pool.execute('SELECT setting_key, setting_value, updated_at FROM platform_settings');
    const settings = { ...platformSettingDefaults } as Record<string, string>;
    for (const row of rows as any[]) settings[row.setting_key] = row.setting_value;
    return settings;
  }

  static async update(values: Record<string, string>, actorUserId: string) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const [key, value] of Object.entries(values)) {
        await connection.execute(
          `INSERT INTO platform_settings (setting_key, setting_value, updated_by)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
          [key, value, actorUserId]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.getAll();
  }
}

export class AdminAuditModel {
  static async record(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId?: string | null,
    details?: Record<string, unknown>
  ) {
    await pool.execute(
      `INSERT INTO admin_audit_logs (id, actor_user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), actorUserId, action, entityType, entityId || null, details ? JSON.stringify(details) : null]
    );
  }
}

export class CustomerModel {
  static async getProfile(userId: string) {
    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.name, u.role, u.created_at, u.updated_at,
              s.id AS subscription_id, s.package_id, s.status AS subscription_status,
              s.start_date, s.end_date,
              p.id AS package_id_detail, p.name AS package_name, p.price, p.device_limit,
              p.message_limit, p.duration_type, p.duration_value,
              a.id AS account_id, a.max_devices,
              (SELECT COUNT(*) FROM devices d WHERE d.account_id = a.id) AS device_count
       FROM users u
       LEFT JOIN accounts a ON a.user_id = u.id
       LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
       LEFT JOIN packages p ON p.id = s.package_id
       WHERE u.id = ?`,
      [userId]
    );
    const users = rows as any[];
    return users.length > 0 ? users[0] : null;
  }

  static async updateProfile(userId: string, input: { name?: string; email?: string }) {
    const updates: string[] = [];
    const values: any[] = [];

    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100) {
        throw new Error('Invalid name');
      }
      updates.push('name = ?');
      values.push(input.name.trim());
    }

    if (input.email !== undefined) {
      if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
        throw new Error('Invalid email');
      }
      const normalizedEmail = input.email.trim().toLowerCase();
      const existingUser = await pool.execute('SELECT id FROM users WHERE email = ? AND id <> ?', [normalizedEmail, userId]);
      const existing = (existingUser as any[])[0];
      if (existing.length > 0) {
        throw new Error('Email already registered');
      }
      updates.push('email = ?');
      values.push(normalizedEmail);
    }

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    values.push(userId);
    await pool.execute(`UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);

    const [rows] = await pool.execute('SELECT id, email, name, role FROM users WHERE id = ?', [userId]);
    const users = rows as any[];
    return users.length > 0 ? users[0] : null;
  }

  static async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      throw new Error('Current password and new password are required');
    }
    if (newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72) {
      throw new Error('New password must be at least 8 characters and no more than 72 bytes');
    }

    const [rows] = await pool.execute('SELECT id, password_hash FROM users WHERE id = ?', [userId]);
    const users = rows as any[];
    if (users.length === 0) {
      throw new Error('User not found');
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
      throw new Error('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.execute(
      'UPDATE users SET password_hash = ?, auth_token_version = auth_token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [passwordHash, userId]
    );

    return { id: user.id };
  }
}
