import { Response, NextFunction } from 'express';
import { ApiKeyModel, DeviceModel } from '../services/database/models';
import { AuthRequest } from './jwt';
import { ApiKeyScope, hasApiKeyScope } from '../services/security/api-keys';

export async function apiKeyAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const presentedKey = req.headers['x-api-key'];

    if (typeof presentedKey !== 'string' || !presentedKey) {
      return res.status(401).json({ success: false, error: 'API key required' });
    }

    const result = await ApiKeyModel.findPresentedKey(presentedKey);
    if (!result.key && result.reason === 'expired') {
      return res.status(403).json({ success: false, error: 'API key expired' });
    }
    if (!result.key) {
      return res.status(403).json({ success: false, error: 'Invalid API key' });
    }

    req.apiKey = result.key;
    req.user = { id: result.key.user_id, role: 'customer' };
    req.account = { id: result.key.account_id };
    await ApiKeyModel.touchLastUsedIfStale(result.key.id);
    next();
  } catch (error) {
    console.error('API key authentication failed:', error);
    return res.status(500).json({ success: false, error: 'Authentication failed' });
  }
}

export function requireApiKeyScope(scope: ApiKeyScope) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.apiKey || !hasApiKeyScope(req.apiKey.permissions, scope)) {
      return res.status(403).json({ success: false, error: `API key lacks required permission: ${scope}` });
    }
    next();
  };
}

export async function deviceOwnership(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const deviceId = req.params.deviceId || req.params.id || req.body.device_id;
    const device = await DeviceModel.findById(deviceId);

    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    if (device.account_id !== req.apiKey?.account_id) {
      return res.status(403).json({ success: false, error: 'Access denied to this device' });
    }

    req.device = device;
    next();
  } catch (error) {
    console.error('Device ownership check error:', error);
    return res.status(500).json({ success: false, error: 'Authorization check failed' });
  }
}
