import { Router } from 'express';
import { AuthRequest, jwtAuth, superadminOnly } from '../../middleware/jwt';
import { AdminAuditModel, PlatformSettingsModel } from '../../services/database/models';

const router = Router();
const numericSettings = new Set([
  'contact_daily_message_limit',
  'contact_weekly_message_limit',
  'send_failure_pause_threshold',
  'send_failure_pause_minutes',
]);
const booleanSettings = new Set(['customer_registration_enabled']);
const allowedSettings = new Set([...numericSettings, ...booleanSettings]);

router.get('/', jwtAuth, superadminOnly, async (_req: AuthRequest, res: any) => {
  try {
    const settings = await PlatformSettingsModel.getAll();
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Platform settings read failed:', error);
    res.status(500).json({ success: false, error: 'Failed to load platform settings' });
  }
});

router.put('/', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  const input = req.body?.settings;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ success: false, error: 'Settings object is required' });
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (!entries.length || entries.some(([key]) => !allowedSettings.has(key))) {
    return res.status(400).json({ success: false, error: 'One or more settings are not supported' });
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (numericSettings.has(key)) {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
        return res.status(400).json({ success: false, error: `${key} must be an integer between 1 and 1000000` });
      }
      normalized[key] = String(parsed);
    } else if (booleanSettings.has(key) && typeof value === 'boolean') {
      normalized[key] = String(value);
    } else {
      return res.status(400).json({ success: false, error: `Invalid value for ${key}` });
    }
  }

  try {
    const settings = await PlatformSettingsModel.update(normalized, req.user.id);
    await AdminAuditModel.record(req.user.id, 'platform_settings_updated', 'platform_settings', null, {
      changed_keys: Object.keys(normalized),
    });
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Platform settings update failed:', error);
    res.status(500).json({ success: false, error: 'Failed to update platform settings' });
  }
});

export default router;
