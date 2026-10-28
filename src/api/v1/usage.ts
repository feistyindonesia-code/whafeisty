import { Router } from 'express';
import { DeviceModel, MessageModel, AccountModel } from '../../services/database/models';
import { jwtAuth, customerOnly, AuthRequest } from '../../middleware/jwt';
import { ApiResponse } from '../../types';

const router = Router();

router.get('/devices', jwtAuth, customerOnly, async (req: AuthRequest, res: any) => {
  try {
    const accounts = await AccountModel.findByUserId(req.user.id);
    if (accounts.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const devices = await DeviceModel.findByAccountId(accounts[0].id);
    res.json({ success: true, data: devices });
  } catch (error) {
    console.error('Get device usage error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch device usage' });
  }
});

router.get('/messages', jwtAuth, customerOnly, async (req: AuthRequest, res: any) => {
  try {
    const accounts = await AccountModel.findByUserId(req.user.id);
    if (accounts.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const devices = await DeviceModel.findByAccountId(accounts[0].id);
    const allMessages: any[] = [];
    for (const device of devices) {
      const messages = await MessageModel.findByDeviceId(device.id, 50, 0);
      allMessages.push(...messages);
    }
    res.json({ success: true, data: allMessages });
  } catch (error) {
    console.error('Get message usage error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch message usage' });
  }
});

export default router;
