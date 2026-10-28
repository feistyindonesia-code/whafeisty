import { AuthRequest } from './jwt';
import { SubscriptionModel, AccountModel, DeviceModel } from '../services/database/models';

export async function checkSubscription(req: AuthRequest, res: any, next: any) {
  try {
    const subscription = await SubscriptionModel.findActiveByUserId(req.user.id);
    if (!subscription) {
      return res.status(403).json({ success: false, error: 'No active subscription' });
    }
    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('Check subscription error:', error);
    return res.status(500).json({ success: false, error: 'Subscription check failed' });
  }
}

export async function checkDeviceLimit(req: AuthRequest, res: any, next: any) {
  try {
    const accounts = await AccountModel.findByUserId(req.user.id);
    if (accounts.length === 0) {
      return res.status(403).json({ success: false, error: 'No account found' });
    }

    const account = accounts[0];
    const devices = await DeviceModel.findByAccountId(account.id);
    const count = devices.length;

    if (count >= account.max_devices) {
      return res.status(403).json({ success: false, error: `Device limit reached (${account.max_devices})` });
    }

    req.account = account;
    next();
  } catch (error) {
    console.error('Check device limit error:', error);
    return res.status(500).json({ success: false, error: 'Device limit check failed' });
  }
}
