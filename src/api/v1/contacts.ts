import { Router } from 'express';
import { ContactConsentModel, ContactModel, DeviceModel, AccountModel } from '../../services/database/models';
import { jwtAuth, customerOnly, AuthRequest } from '../../middleware/jwt';
import { Response } from 'express';
import { ApiResponse } from '../../types';

const router = Router();

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const phone = value.trim().replace(/@s\.whatsapp\.net$/, '').replace(/^\+/, '');
  return /^\d{5,20}$/.test(phone) ? phone : null;
}

async function getCustomerAccount(userId: string) {
  const accounts = await AccountModel.findByUserId(userId);
  return accounts[0] || null;
}

router.get('/consents', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const account = await getCustomerAccount(req.user.id);
    if (!account) {
      return res.status(403).json({ success: false, error: 'No account found' });
    }
    const consents = await ContactConsentModel.findByAccount(account.id);
    res.json({ success: true, data: consents });
  } catch (error) {
    console.error('List contact consents error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch contact consents' });
  }
});

router.get('/consents/:phone/events', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const phoneNumber = normalizePhone(req.params.phone);
    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: 'Invalid phone number' });
    }
    const account = await getCustomerAccount(req.user.id);
    if (!account) {
      return res.status(403).json({ success: false, error: 'No account found' });
    }
    const events = await ContactConsentModel.findEvents(account.id, phoneNumber);
    res.json({ success: true, data: events });
  } catch (error) {
    console.error('Get contact consent history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch consent history' });
  }
});

router.post('/consents', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const phoneNumber = normalizePhone(req.body.phone_number);
    const { purpose, source, evidence } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: 'A valid phone_number is required' });
    }
    if (
      typeof purpose !== 'string' || !purpose.trim() || purpose.trim().length > 255 ||
      typeof source !== 'string' || !source.trim() || source.trim().length > 100 ||
      typeof evidence !== 'string' || !evidence.trim() || evidence.trim().length > 2000
    ) {
      return res.status(400).json({ success: false, error: 'Purpose, consent source, and evidence are required (evidence max 2000 characters)' });
    }

    const account = await getCustomerAccount(req.user.id);
    if (!account) {
      return res.status(403).json({ success: false, error: 'No account found' });
    }
    const consent = await ContactConsentModel.recordConsent({
      accountId: account.id,
      phoneNumber,
      purpose: purpose.trim(),
      source: source.trim(),
      evidence: evidence.trim(),
      recordedBy: req.user.id,
    });
    res.status(201).json({ success: true, data: consent });
  } catch (error) {
    console.error('Record contact consent error:', error);
    res.status(500).json({ success: false, error: 'Failed to record contact consent' });
  }
});

router.post('/consents/revoke', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const phoneNumber = normalizePhone(req.body.phone_number);
    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: 'A valid phone_number is required' });
    }
    const account = await getCustomerAccount(req.user.id);
    if (!account) {
      return res.status(403).json({ success: false, error: 'No account found' });
    }
    await ContactConsentModel.revokeConsent({
      accountId: account.id,
      phoneNumber,
      source: 'customer_manual',
      evidence: typeof req.body.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 2000)
        : 'Consent manually revoked by customer workspace',
      recordedBy: req.user.id,
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke contact consent error:', error);
    res.status(500).json({ success: false, error: 'Failed to revoke contact consent' });
  }
});

router.get('/:deviceId', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
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

    const contacts = await ContactModel.findByDeviceId(deviceId);
    res.json({ success: true, data: contacts });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch contacts' });
  }
});

router.get('/:deviceId/:phone', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const { deviceId, phone } = req.params;

    const device = await DeviceModel.findById(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    const accounts = await AccountModel.findByUserId(req.user.id);
    const account = accounts.find(a => a.id === device.account_id);
    if (!account) {
      return res.status(403).json({ success: false, error: 'Access denied to this device' });
    }

    const contact = await ContactModel.findByDeviceIdAndPhone(deviceId, phone);
    if (!contact) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    res.json({ success: true, data: contact });
  } catch (error) {
    console.error('Error fetching contact:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch contact' });
  }
});

export default router;
