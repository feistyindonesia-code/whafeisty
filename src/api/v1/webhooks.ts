import { Router } from 'express';
import { WebhookModel, AccountModel } from '../../services/database/models';
import { jwtAuth, customerOnly, AuthRequest } from '../../middleware/jwt';
import { Response } from 'express';
import { ApiResponse } from '../../types';

const router = Router();

router.post('/', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const { url, events, secret } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const accounts = await AccountModel.findByUserId(req.user.id);
    if (accounts.length === 0) {
      return res.status(403).json({ success: false, error: 'No account found' });
    }

    const webhook = await WebhookModel.create(accounts[0].id, url, events || [], secret);
    res.status(201).json({ success: true, data: webhook });
  } catch (error) {
    console.error('Error creating webhook:', error);
    res.status(500).json({ success: false, error: 'Failed to create webhook' });
  }
});

router.get('/', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const accounts = await AccountModel.findByUserId(req.user.id);
    if (accounts.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const webhooks = await WebhookModel.findByAccountId(accounts[0].id);
    res.json({ success: true, data: webhooks });
  } catch (error) {
    console.error('Error fetching webhooks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch webhooks' });
  }
});

router.put('/:id', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const { url, events, secret } = req.body;
    const webhook = await WebhookModel.findById(req.params.id);

    if (!webhook) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    const accounts = await AccountModel.findByUserId(req.user.id);
    const account = accounts.find(a => a.id === webhook.account_id);
    if (!account) {
      return res.status(403).json({ success: false, error: 'Access denied to this webhook' });
    }

    await WebhookModel.update(req.params.id, url, events, secret);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating webhook:', error);
    res.status(500).json({ success: false, error: 'Failed to update webhook' });
  }
});

router.delete('/:id', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const webhook = await WebhookModel.findById(req.params.id);

    if (!webhook) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    const accounts = await AccountModel.findByUserId(req.user.id);
    const account = accounts.find(a => a.id === webhook.account_id);
    if (!account) {
      return res.status(403).json({ success: false, error: 'Access denied to this webhook' });
    }

    await WebhookModel.delete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(500).json({ success: false, error: 'Failed to delete webhook' });
  }
});

export default router;
