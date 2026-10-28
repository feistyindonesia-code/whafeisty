import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  AccountModel,
  AdminAuditModel,
  ApiKeyModel,
  CustomerModel,
  PlatformSettingsModel,
  UserModel,
  PackageModel,
} from '../../services/database/models';
import { generateToken, jwtAuth, AuthRequest, customerOnly, superadminOnly } from '../../middleware/jwt';
import { checkSubscription } from '../../middleware/subscription';
import {
  loginRateLimitStore,
  passwordResetRateLimitStore,
  registrationRateLimitStore,
} from '../../middleware/redis-rate-limit-store';
import { normalizeApiKeyScopes } from '../../services/security/api-keys';
import { createPasswordResetCode, hashPasswordResetCode } from '../../services/security/password-reset';
import { isPasswordResetEmailConfigured, sendPasswordResetEmail } from '../../services/email/password-reset-mailer';
import { pool } from '../../services/database/connection';

const router = Router();
const useLocalDevelopmentLimiter = process.env.NODE_ENV === 'development';

const authenticationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  ...(useLocalDevelopmentLimiter ? {} : { store: loginRateLimitStore }),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many authentication attempts. Try again later.' },
});

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  ...(useLocalDevelopmentLimiter ? {} : { store: registrationRateLimitStore }),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many registration attempts. Try again later.' },
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  ...(useLocalDevelopmentLimiter ? {} : { store: passwordResetRateLimitStore }),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many password reset attempts. Try again later.' },
});

function isDuplicateEntryError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
}

function parseExpiry(value: unknown): { valid: boolean; date?: Date | null } {
  if (value === undefined) return { valid: true };
  if (value === null) return { valid: true, date: null };
  if (typeof value !== 'string') return { valid: false };
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return { valid: false };
  return { valid: true, date };
}

async function getApiKeyAccount(userId: string) {
  const accounts = await AccountModel.findByUserId(userId);
  return accounts[0] || null;
}

router.post('/register', registrationLimiter, async (req: any, res: any) => {
  try {
    const platformSettings = await PlatformSettingsModel.getAll();
    if (platformSettings.customer_registration_enabled === 'false') {
      return res.status(503).json({ success: false, error: 'Customer registration is temporarily unavailable' });
    }
    const { name, email, password, package_id } = req.body;

    if (
      typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
      typeof email !== 'string' || email.trim().length > 255 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || !package_id || typeof package_id !== 'string'
    ) {
      return res.status(400).json({ success: false, error: 'Name, email, password, and package_id are required' });
    }
    if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters and no more than 72 bytes' });
    }

    const pkg = await PackageModel.findById(package_id);
    if (!pkg || !pkg.active) {
      return res.status(400).json({ success: false, error: 'Selected package is unavailable' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await UserModel.findByEmail(normalizedEmail);
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'Email already registered' });
    }

    const registration = await UserModel.createCustomerRegistration({
      name: name.trim(),
      email: normalizedEmail,
      password,
      packageId: package_id,
      deviceLimit: Number(pkg.device_limit),
    });

    const token = generateToken(registration.user);

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: registration.user.id,
          email: registration.user.email,
          name: registration.user.name,
          role: registration.user.role,
        },
        token,
        subscription_id: registration.subscription.id,
        account_id: registration.account.id,
      },
    });
  } catch (error) {
    if (isDuplicateEntryError(error)) {
      return res.status(409).json({ success: false, error: 'Email already registered' });
    }
    console.error('Register error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

router.post('/login', authenticationLimiter, async (req: any, res: any) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== 'string' || email.trim().length > 255 ||
      typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72
    ) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const user = await UserModel.findByEmail(email.trim().toLowerCase());
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const validPassword = await UserModel.verifyPassword(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

router.post('/password/forgot', passwordResetLimiter, async (req: any, res: any) => {
  const genericResponse = {
    success: true,
    message: 'If an account exists for that email, a password reset code will be sent.',
  };
  try {
    const email = req.body?.email;
    if (typeof email !== 'string' || email.trim().length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ success: false, error: 'Enter a valid email address' });
    }
    if (!isPasswordResetEmailConfigured()) {
      return res.status(503).json({ success: false, error: 'Password reset email is not configured' });
    }

    const { code, codeHash } = createPasswordResetCode();
    const user = await UserModel.createPasswordReset(
      email.trim().toLowerCase(),
      codeHash,
      new Date(Date.now() + 30 * 60 * 1000)
    );
    res.status(202).json(genericResponse);
    if (user) {
      try {
        await sendPasswordResetEmail(user.email, code);
      } catch (error) {
        console.error(
          'Password reset email delivery failed:',
          error instanceof Error ? error.message : 'Unknown email transport error'
        );
        try {
          await UserModel.invalidatePasswordReset(codeHash);
        } catch (cleanupError) {
          console.error('Failed to invalidate undelivered password reset token:', cleanupError);
        }
      }
    }
    return;
  } catch (error) {
    console.error('Password reset request failed:', error);
    return res.status(500).json({ success: false, error: 'Password reset request could not be processed' });
  }
});

router.post('/password/reset', passwordResetLimiter, async (req: any, res: any) => {
  const { email, code, password } = req.body || {};
  if (
    typeof email !== 'string' || email.trim().length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof code !== 'string' || !/^\d{6}$/.test(code) ||
    typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72
  ) {
    return res.status(400).json({
      success: false,
      error: 'A valid email, 6-digit reset code, and password of at least 8 characters and no more than 72 bytes are required',
    });
  }

  try {
    const completed = await UserModel.completePasswordReset(
      email.trim().toLowerCase(),
      hashPasswordResetCode(code),
      password
    );
    if (!completed) {
      return res.status(400).json({ success: false, error: 'Reset code is invalid, expired, or has been used' });
    }
    return res.json({ success: true, message: 'Password reset successfully. Please sign in again.' });
  } catch (error) {
    console.error('Password reset completion failed:', error);
    return res.status(500).json({ success: false, error: 'Password could not be reset' });
  }
});

router.post('/superadmin/login', authenticationLimiter, async (req: any, res: any) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== 'string' || email.trim().length > 255 ||
      typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72
    ) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const user = await UserModel.findByEmail(email.trim().toLowerCase());
    if (!user || user.role !== 'superadmin') {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const validPassword = await UserModel.verifyPassword(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        token,
      },
    });
  } catch (error) {
    console.error('SuperAdmin login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

router.get('/me', jwtAuth, async (req: AuthRequest, res: any) => {
  try {
    res.json({
      success: true,
      data: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role,
      },
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ success: false, error: 'Failed to get user' });
  }
});

router.put('/me', jwtAuth, customerOnly, async (req: AuthRequest, res: any) => {
  try {
    const { name, email } = req.body || {};

    if (name === undefined && email === undefined) {
      return res.status(400).json({ success: false, error: 'At least one field (name or email) is required' });
    }

    const updated = await CustomerModel.updateProfile(req.user.id, {
      name: name !== undefined ? name : undefined,
      email: email !== undefined ? email : undefined,
    });

    res.json({
      success: true,
      data: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
      },
    });
  } catch (error: any) {
    console.error('Update profile error:', error);
    if (error.message === 'Email already registered') {
      return res.status(409).json({ success: false, error: error.message });
    }
    return res.status(400).json({ success: false, error: error.message || 'Failed to update profile' });
  }
});

router.put('/password', jwtAuth, customerOnly, async (req: AuthRequest, res: any) => {
  try {
    const { current_password, new_password } = req.body || {};

    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required' });
    }

    await CustomerModel.changePassword(req.user.id, current_password, new_password);

    return res.json({
      success: true,
      message: 'Password changed successfully. Please sign in again with your new password.',
    });
  } catch (error: any) {
    console.error('Change password error:', error);
    if (error.message === 'Current password is incorrect') {
      return res.status(401).json({ success: false, error: error.message });
    }
    if (error.message === 'User not found') {
      return res.status(404).json({ success: false, error: error.message });
    }
    return res.status(400).json({ success: false, error: error.message || 'Failed to change password' });
  }
});

router.get('/admin/customers', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.created_at,
         s.status AS subscription_status, s.start_date, s.end_date,
         p.id AS package_id, p.name AS package_name,
         a.id AS account_id, a.max_devices,
         (SELECT COUNT(*) FROM devices d WHERE d.account_id = a.id) AS device_count
       FROM users u
       LEFT JOIN accounts a ON a.id = (
         SELECT a2.id FROM accounts a2 WHERE a2.user_id = u.id LIMIT 1
       )
       LEFT JOIN subscriptions s ON s.id = (
         SELECT s2.id FROM subscriptions s2
         WHERE s2.user_id = u.id ORDER BY s2.created_at DESC LIMIT 1
       )
       LEFT JOIN packages p ON p.id = s.package_id
       WHERE u.role = 'customer'
         AND (? = '' OR u.name LIKE ? OR u.email LIKE ?)
       ORDER BY u.created_at DESC
       LIMIT 200`,
      [search, `%${search}%`, `%${search}%`]
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Admin customer listing failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to list customers' });
  }
});

router.patch('/admin/customers/:id/subscription', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  const action = req.body?.action;
  if (action !== 'suspend' && action !== 'reactivate') {
    return res.status(400).json({ success: false, error: 'Action must be suspend or reactivate' });
  }
  try {
    const [subscriptionRows] = await pool.execute(
      `SELECT id, status, end_date FROM subscriptions
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );
    const subscription = (subscriptionRows as any[])[0];
    if (!subscription) return res.status(404).json({ success: false, error: 'Customer subscription not found' });
    if (action === 'suspend' && subscription.status !== 'active') {
      return res.status(409).json({ success: false, error: 'Only an active subscription can be suspended' });
    }
    if (action === 'reactivate' && (
      subscription.status !== 'suspended' ||
      (subscription.end_date && new Date(subscription.end_date) <= new Date())
    )) {
      return res.status(409).json({ success: false, error: 'Only a suspended, unexpired subscription can be reactivated' });
    }

    const status = action === 'suspend' ? 'suspended' : 'active';
    const [result] = await pool.execute(
      'UPDATE subscriptions SET status = ? WHERE id = ? AND status = ?',
      [status, subscription.id, subscription.status]
    );
    if ((result as any).affectedRows !== 1) {
      return res.status(409).json({ success: false, error: 'Subscription changed; refresh and try again' });
    }
    await AdminAuditModel.record(req.user.id, `customer_subscription_${action}`, 'subscription', subscription.id, {
      customer_id: req.params.id,
    });
    return res.json({ success: true, data: { status } });
  } catch (error) {
    console.error('Customer subscription administration failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to update customer subscription' });
  }
});

router.get('/admin/audit', jwtAuth, superadminOnly, async (_req: AuthRequest, res: any) => {
  try {
    const [rows] = await pool.execute(
      `SELECT l.id, l.action, l.entity_type, l.entity_id, l.details, l.created_at,
         u.email AS actor_email, u.name AS actor_name
       FROM admin_audit_logs l
       LEFT JOIN users u ON u.id = l.actor_user_id
       ORDER BY l.created_at DESC
       LIMIT 200`
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Admin audit log listing failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch audit logs' });
  }
});

router.get('/api-keys', jwtAuth, customerOnly, async (req: AuthRequest, res: any) => {
  try {
    const account = await getApiKeyAccount(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const keys = await ApiKeyModel.findByAccountId(account.id);
    res.json({ success: true, data: keys });
  } catch (error) {
    console.error('List API keys failed:', error);
    res.status(500).json({ success: false, error: 'Failed to list API keys' });
  }
});

router.post('/api-keys', jwtAuth, customerOnly, checkSubscription, async (req: AuthRequest, res: any) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const scopes = normalizeApiKeyScopes(req.body.scopes);
    const expiry = parseExpiry(req.body.expires_at);
    if (!name || name.length > 100 || !scopes || scopes.length === 0 || !expiry.valid) {
      return res.status(400).json({ success: false, error: 'A name, valid scopes, and a future expires_at (or null) are required' });
    }
    const account = await getApiKeyAccount(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const created = await ApiKeyModel.create({
      accountId: account.id,
      actorUserId: req.user.id,
      name,
      scopes,
      expiresAt: expiry.date ?? null,
    });
    res.status(201).json({
      success: true,
      data: { ...created.key, secret: created.secret, secret_displayed_once: true },
    });
  } catch (error) {
    console.error('Create API key failed:', error);
    res.status(500).json({ success: false, error: 'Failed to create API key' });
  }
});

router.patch('/api-keys/:id', jwtAuth, customerOnly, async (req: AuthRequest, res: any) => {
  try {
    const name = req.body.name === undefined
      ? undefined
      : typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const scopes = req.body.scopes === undefined ? undefined : normalizeApiKeyScopes(req.body.scopes);
    const expiry = parseExpiry(req.body.expires_at);
    if (
      (!name && name !== undefined) ||
      (name !== undefined && name.length > 100) ||
      (req.body.scopes !== undefined && !scopes) ||
      !expiry.valid
    ) {
      return res.status(400).json({ success: false, error: 'Invalid API key name, scopes, or expiration' });
    }
    const account = await getApiKeyAccount(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const updated = await ApiKeyModel.update({
      accountId: account.id,
      actorUserId: req.user.id,
      id: req.params.id,
      name,
      scopes: scopes || undefined,
      expiresAt: expiry.date,
    });
    if (!updated) return res.status(404).json({ success: false, error: 'Active API key not found' });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Update API key failed:', error);
    res.status(500).json({ success: false, error: 'Failed to update API key' });
  }
});

router.post('/api-keys/:id/rotate', jwtAuth, customerOnly, checkSubscription, async (req: AuthRequest, res: any) => {
  try {
    const name = req.body.name === undefined
      ? undefined
      : typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const scopes = req.body.scopes === undefined ? undefined : normalizeApiKeyScopes(req.body.scopes);
    const expiry = parseExpiry(req.body.expires_at);
    if (
      (name !== undefined && (!name || name.length > 100)) ||
      (req.body.scopes !== undefined && (!scopes || scopes.length === 0)) ||
      !expiry.valid
    ) {
      return res.status(400).json({ success: false, error: 'Invalid API key name, scopes, or expiration' });
    }
    const account = await getApiKeyAccount(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const rotated = await ApiKeyModel.rotate({
      accountId: account.id,
      actorUserId: req.user.id,
      id: req.params.id,
      name,
      scopes: scopes || undefined,
      expiresAt: expiry.date,
    });
    if (!rotated) return res.status(404).json({ success: false, error: 'Active API key not found' });
    res.json({
      success: true,
      data: { ...rotated.key, secret: rotated.secret, secret_displayed_once: true },
    });
  } catch (error) {
    console.error('Rotate API key failed:', error);
    res.status(500).json({ success: false, error: 'Failed to rotate API key' });
  }
});

router.delete('/api-keys/:id', jwtAuth, customerOnly, async (req: AuthRequest, res: any) => {
  try {
    const account = await getApiKeyAccount(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const revoked = await ApiKeyModel.revoke({
      accountId: account.id,
      actorUserId: req.user.id,
      id: req.params.id,
    });
    if (!revoked) return res.status(404).json({ success: false, error: 'Active API key not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke API key failed:', error);
    res.status(500).json({ success: false, error: 'Failed to revoke API key' });
  }
});

export default router;
