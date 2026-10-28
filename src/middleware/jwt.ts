import 'dotenv/config';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AccountModel, DeviceModel, PackageModel, SubscriptionModel, UserModel } from '../services/database/models';

export interface AuthRequest extends Request {
  user?: any;
  subscription?: any;
  account?: any;
  device?: any;
  apiKey?: any;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (
    !secret ||
    secret.length < 32 ||
    secret === 'super_secret_key_minimum_32_chars_change_this_in_production' ||
    secret === 'change_this_in_production' ||
    secret === 'your_secret_key_here'
  ) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters');
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();

export function generateToken(user: {
  id: string;
  email: string;
  role: string;
  auth_token_version?: number | string | null;
}) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: Number(user.auth_token_version || 0),
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export async function jwtAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Token required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    const user = await UserModel.findById(decoded.id);
    if (!user || Number(decoded.tokenVersion || 0) !== Number(user.auth_token_version || 0)) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

export async function superadminOnly(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'SuperAdmin only' });
  }
  next();
}

export async function customerOnly(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'customer') {
    return res.status(403).json({ success: false, error: 'Customer only' });
  }
  next();
}

export function requirePackageFeature(feature: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const subscription = req.subscription || await SubscriptionModel.findActiveByUserId(req.user.id);
      if (!subscription) {
        return res.status(403).json({ success: false, error: 'No active subscription' });
      }
      const pkg = await PackageModel.findById(subscription.package_id);
      if (!pkg) {
        return res.status(403).json({ success: false, error: 'Active package not found' });
      }
      let features = pkg.features;
      if (typeof features === 'string') features = JSON.parse(features);
      if (!features || typeof features !== 'object' || features[feature] !== true) {
        return res.status(403).json({ success: false, error: 'This feature is not included in the active package' });
      }
      req.subscription = subscription;
      next();
    } catch (error) {
      console.error(`Package feature check failed for "${feature}":`, error);
      return res.status(500).json({ success: false, error: 'Package feature access check failed' });
    }
  };
}

export async function checkDeviceOwnership(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const deviceId = req.params.id || req.params.deviceId || req.body.device_id;
    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'Device ID is required' });
    }

    const device = await DeviceModel.findById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    const accounts = await AccountModel.findByUserId(req.user.id);
    if (!accounts.some((account) => account.id === device.account_id)) {
      return res.status(403).json({ success: false, error: 'Access denied to this device' });
    }

    req.device = device;
    next();
  } catch (error) {
    console.error('Device ownership check error:', error);
    return res.status(500).json({ success: false, error: 'Authorization check failed' });
  }
}
