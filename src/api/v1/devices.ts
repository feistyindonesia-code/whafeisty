import { Router } from 'express';
import { BaileysClient } from '../../services/whatsapp/baileys-client';
import { AccountModel, DeviceLimitReachedError, DeviceModel } from '../../services/database/models';
import { jwtAuth, customerOnly, checkDeviceOwnership, AuthRequest } from '../../middleware/jwt';
import { checkSubscription } from '../../middleware/subscription';
import { Response } from 'express';
import { ApiResponse } from '../../types';
import { apiKeyAuth, deviceOwnership, requireApiKeyScope } from '../../middleware/auth';

const router = Router();

router.get('/', jwtAuth, customerOnly, checkSubscription, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const accounts = await AccountModel.findByUserId(req.user.id);
    if (accounts.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const devices = await DeviceModel.findByAccountId(accounts[0].id);
    res.json({ success: true, data: devices });
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch devices' });
  }
});

router.post('/', jwtAuth, customerOnly, checkSubscription, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const accounts = await AccountModel.findByUserId(req.user.id);
    const account = accounts[0];
    if (!account) {
      return res.status(403).json({ success: false, error: 'No account found' });
    }
    const device = await BaileysClient.createDevice(account.id);
    res.status(201).json({ success: true, data: device });
  } catch (error) {
    if (error instanceof DeviceLimitReachedError) {
      return res.status(409).json({ success: false, error: error.message });
    }
    if (error instanceof Error && error.message === 'No active subscription') {
      return res.status(403).json({ success: false, error: error.message });
    }
    console.error('Error creating device:', error);
    res.status(500).json({ success: false, error: 'Failed to create device' });
  }
});

router.get('/external', apiKeyAuth, requireApiKeyScope('devices:read'), checkSubscription, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const devices = await DeviceModel.findByAccountId(req.apiKey.account_id);
    res.json({ success: true, data: devices });
  } catch (error) {
    console.error('External API device listing failed:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch devices' });
  }
});

router.get('/external/:id', apiKeyAuth, requireApiKeyScope('devices:read'), checkSubscription, deviceOwnership, async (req: AuthRequest, res: Response<ApiResponse>) => {
  res.json({ success: true, data: req.device });
});

router.get('/:id', jwtAuth, customerOnly, checkSubscription, checkDeviceOwnership, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    res.json({ success: true, data: req.device });
  } catch (error) {
    console.error('Error fetching device:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch device' });
  }
});

router.delete('/:id', jwtAuth, customerOnly, checkSubscription, checkDeviceOwnership, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    await BaileysClient.disconnectDevice(req.params.id);
    await DeviceModel.delete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ success: false, error: 'Failed to delete device' });
  }
});

router.get('/:id/qrcode', jwtAuth, customerOnly, checkSubscription, checkDeviceOwnership, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const qrData = await BaileysClient.getQRCode(req.params.id);
    if (qrData) {
      res.json({ success: true, data: { qr: qrData } });
    } else {
      res.status(409).json({ success: false, error: 'Pairing QR code is not available yet' });
    }
  } catch (error) {
    console.error('Error fetching QR code:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch QR code' });
  }
});

router.post('/:id/connect', jwtAuth, customerOnly, checkSubscription, checkDeviceOwnership, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const device = req.device as any;
    await BaileysClient.connectDevice(device.id);
    res.json({ success: true, data: device });
  } catch (error) {
    console.error('Error reconnecting device:', error);
    res.status(500).json({ success: false, error: 'Failed to reconnect device' });
  }
});

router.post('/:id/disconnect', jwtAuth, customerOnly, checkSubscription, checkDeviceOwnership, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    await BaileysClient.disconnectDevice(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting device:', error);
    res.status(500).json({ success: false, error: 'Failed to disconnect device' });
  }
});

router.get('/:id/status', jwtAuth, customerOnly, checkSubscription, checkDeviceOwnership, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    res.json({ success: true, data: req.device });
  } catch (error) {
    console.error('Error fetching device status:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch device status' });
  }
});

export default router;