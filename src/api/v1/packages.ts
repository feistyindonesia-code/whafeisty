import { Router } from 'express';
import { AdminAuditModel, PackageModel, SubscriptionModel } from '../../services/database/models';
import { jwtAuth, superadminOnly, customerOnly, AuthRequest } from '../../middleware/jwt';
import { ApiResponse } from '../../types';

const router = Router();
const packageFeatures = [
  'api_docs',
  'crm',
  'broadcast',
  'automessage',
  'customer_service',
  'advertising',
  'professional',
] as const;

function validateFeatures(value: unknown): Record<string, boolean> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const featureMap = value as Record<string, unknown>;
  const entries = Object.entries(featureMap);
  if (entries.some(([key, enabled]) => !packageFeatures.includes(key as typeof packageFeatures[number]) || typeof enabled !== 'boolean')) {
    return null;
  }
  return Object.fromEntries(packageFeatures.map((feature) => [feature, featureMap[feature] === true]));
}

router.get('/', async (req: AuthRequest, res: any) => {
  try {
    const packages = await PackageModel.findActive();
    res.json({ success: true, data: packages });
  } catch (error) {
    console.error('List packages error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch packages' });
  }
});

router.get('/:id', async (req: AuthRequest, res: any) => {
  try {
    const pkg = await PackageModel.findById(req.params.id);
    if (!pkg || !pkg.active) {
      return res.status(404).json({ success: false, error: 'Package not found' });
    }
    res.json({ success: true, data: pkg });
  } catch (error) {
    console.error('Get package error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch package' });
  }
});

router.post('/', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    const { name, price, device_limit, message_limit, duration_type, duration_value, description } = req.body;
    const features = validateFeatures(req.body.features);
    if (!name || price === undefined || price === null || device_limit === undefined || device_limit === null || message_limit === undefined || message_limit === null || !duration_type || duration_value === undefined || duration_value === null) {
      return res.status(400).json({ success: false, error: 'Name, price, device_limit, message_limit, duration_type, and duration_value are required' });
    }
    if (
      typeof name !== 'string' || !name.trim() ||
      !Number.isFinite(Number(price)) || Number(price) < 0 ||
      !Number.isInteger(Number(device_limit)) || Number(device_limit) < 1 ||
      !Number.isInteger(Number(message_limit)) || Number(message_limit) < 0 ||
      !['daily', 'weekly', 'monthly', 'yearly'].includes(duration_type) ||
      !Number.isInteger(Number(duration_value)) || Number(duration_value) < 1 ||
      !features
    ) {
      return res.status(400).json({ success: false, error: 'Package values are invalid' });
    }
    const pkg = await PackageModel.create({ name, price, device_limit, message_limit, duration_type, duration_value, description, features });
    await AdminAuditModel.record(req.user.id, 'package_created', 'package', pkg.id, {
      name: pkg.name,
      price: pkg.price,
    });
    res.status(201).json({ success: true, data: pkg });
  } catch (error) {
    console.error('Create package error:', error);
    res.status(500).json({ success: false, error: 'Failed to create package' });
  }
});

router.put('/:id', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    const { name, price, device_limit, message_limit, duration_type, duration_value, description, active } = req.body;
    const features = req.body.features === undefined ? undefined : validateFeatures(req.body.features);
    if (
      (name !== undefined && (typeof name !== 'string' || !name.trim())) ||
      (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 0)) ||
      (device_limit !== undefined && (!Number.isInteger(Number(device_limit)) || Number(device_limit) < 1)) ||
      (message_limit !== undefined && (!Number.isInteger(Number(message_limit)) || Number(message_limit) < 0)) ||
      (duration_type !== undefined && !['daily', 'weekly', 'monthly', 'yearly'].includes(duration_type)) ||
      (duration_value !== undefined && (!Number.isInteger(Number(duration_value)) || Number(duration_value) < 1)) ||
      (active !== undefined && typeof active !== 'boolean') ||
      (req.body.features !== undefined && !features)
    ) {
      return res.status(400).json({ success: false, error: 'Package values are invalid' });
    }
    await PackageModel.update(req.params.id, {
      name, price, device_limit, message_limit, duration_type, duration_value, description, active,
      features: features || undefined,
    });
    await AdminAuditModel.record(req.user.id, 'package_updated', 'package', req.params.id, {
      changed_fields: Object.keys(req.body || {}),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Update package error:', error);
    res.status(500).json({ success: false, error: 'Failed to update package' });
  }
});

router.delete('/:id', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    await PackageModel.delete(req.params.id);
    await AdminAuditModel.record(req.user.id, 'package_deleted', 'package', req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete package error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete package' });
  }
});

router.get('/me/active', jwtAuth, customerOnly, async (req: AuthRequest, res: any) => {
  try {
    const subscription = await SubscriptionModel.findActiveByUserId(req.user.id);
    if (!subscription) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: subscription });
  } catch (error) {
    console.error('Get active subscription error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch subscription' });
  }
});

router.get('/me/features', jwtAuth, customerOnly, async (req: AuthRequest, res: any) => {
  try {
    const pkg = await SubscriptionModel.findActivePackageByUserId(req.user.id);
    res.json({
      success: true,
      data: {
        package_id: pkg?.id || null,
        package_name: pkg?.name || null,
        features: pkg?.features || {},
      },
    });
  } catch (error) {
    console.error('Get package features error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch package features' });
  }
});

export default router;
