import { Router } from 'express';
import { pool } from '../../services/database/connection';
import { AdminAuditModel, SubscriptionModel } from '../../services/database/models';
import { jwtAuth, superadminOnly, customerOnly, AuthRequest } from '../../middleware/jwt';
import { ApiResponse } from '../../types';

const router = Router();

router.get('/me', jwtAuth, customerOnly, async (req: AuthRequest, res: any) => {
  try {
    const subscriptions = await SubscriptionModel.findByUserId(req.user.id);
    res.json({ success: true, data: subscriptions });
  } catch (error) {
    console.error('Get subscriptions error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch subscriptions' });
  }
});

router.get('/pending', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    const pending = await SubscriptionModel.findPending();
    res.json({ success: true, data: pending });
  } catch (error) {
    console.error('Get pending subscriptions error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch pending subscriptions' });
  }
});

router.post('/:id/approve', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    const [subscriptionRows] = await pool.execute(
      'SELECT * FROM subscriptions WHERE id = ?',
      [req.params.id]
    );
    const subscription = (subscriptionRows as any[])[0];
    if (!subscription) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }
    if (subscription.status === 'active') {
      return res.json({ success: true, data: { already_active: true } });
    }
    if (subscription.status !== 'pending') {
      return res.status(409).json({ success: false, error: 'Subscription is no longer pending' });
    }

    const [paymentRows] = await pool.execute(
      "SELECT id FROM payments WHERE user_id = ? AND package_id = ? AND status = 'paid' LIMIT 1",
      [subscription.user_id, subscription.package_id]
    );
    if ((paymentRows as any[]).length === 0) {
      return res.status(409).json({
        success: false,
        error: 'Approve the related payment first. Approving a payment activates its subscription automatically.',
      });
    }

    const [packageRows] = await pool.execute(
      'SELECT * FROM packages WHERE id = ?',
      [subscription.package_id]
    );
    const pkg = (packageRows as any[])[0];
    if (!pkg) {
      return res.status(404).json({ success: false, error: 'Package not found' });
    }

    const now = new Date();
    const endDate = await SubscriptionModel.calculateEndDate(now, pkg.duration_type, pkg.duration_value);

    const updated = await SubscriptionModel.updateStatus(req.params.id, 'active', now, endDate);
    if (!updated) {
      const latestSubscription = await SubscriptionModel.findById(req.params.id);
      if (latestSubscription?.status === 'active') {
        return res.json({ success: true, data: { already_active: true } });
      }
      return res.status(409).json({ success: false, error: 'Subscription is no longer pending' });
    }

    await AdminAuditModel.record(req.user.id, 'subscription_approved', 'subscription', req.params.id, {
      user_id: subscription.user_id,
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Approve subscription error:', error);
    res.status(500).json({ success: false, error: 'Failed to approve subscription' });
  }
});

router.post('/:id/reject', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    const subscription = await SubscriptionModel.findById(req.params.id);
    if (!subscription) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }
    const updated = await SubscriptionModel.updateStatus(req.params.id, 'suspended');
    if (!updated) {
      return res.status(409).json({ success: false, error: 'Subscription is no longer pending' });
    }
    await AdminAuditModel.record(req.user.id, 'subscription_rejected', 'subscription', req.params.id, {
      user_id: subscription.user_id,
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Reject subscription error:', error);
    res.status(500).json({ success: false, error: 'Failed to reject subscription' });
  }
});

export default router;
