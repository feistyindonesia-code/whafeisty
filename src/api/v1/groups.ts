import { Router } from 'express';
import { BaileysClient } from '../../services/whatsapp/baileys-client';
import { AccountModel, DeviceModel } from '../../services/database/models';
import { jwtAuth, customerOnly, AuthRequest } from '../../middleware/jwt';
import { checkSubscription } from '../../middleware/subscription';
import { Response } from 'express';
import { ApiResponse } from '../../types';

const router = Router();

router.get('/:deviceId', jwtAuth, customerOnly, checkSubscription, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const deviceId = req.params.deviceId;

    const device = await DeviceModel.findById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    const accounts = await AccountModel.findByUserId(req.user.id);
    const account = accounts.find(a => a.id === device.account_id);
    if (!account) {
      return res.status(403).json({ success: false, error: 'Access denied to this device' });
    }

    const sock = BaileysClient.getDeviceSocket(deviceId);
    if (!sock) {
      return res.status(400).json({ success: false, error: 'Device not connected' });
    }

    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.values(groups).map((group: any) => ({
      id: group.id,
      name: group.subject,
      participants: group.participants?.map((p: any) => p.id) || [],
    }));

    res.json({ success: true, data: groupList });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch groups' });
  }
});

router.post('/:deviceId', jwtAuth, customerOnly, checkSubscription, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const { deviceId } = req.params;
    const { subject, participants } = req.body;

    const device = await DeviceModel.findById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    const accounts = await AccountModel.findByUserId(req.user.id);
    const account = accounts.find(a => a.id === device.account_id);
    if (!account) {
      return res.status(403).json({ success: false, error: 'Access denied to this device' });
    }

    const sock = BaileysClient.getDeviceSocket(deviceId);
    if (!sock) {
      return res.status(400).json({ success: false, error: 'Device not connected' });
    }

    const group = await sock.groupCreate(subject, participants.map((p: string) => ({ id: p })));

    res.status(201).json({ success: true, data: group });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ success: false, error: 'Failed to create group' });
  }
});

export default router;
