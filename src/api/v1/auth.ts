import { Router } from 'express';
import { Request, Response } from 'express';

const router = Router();

router.post('/account', async (req: Request, res: any) => {
  try {
    res.status(501).json({ success: false, error: 'Use /api/v1/users/register instead' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create account' });
  }
});

router.get('/key', async (req: Request, res: any) => {
  try {
    res.status(501).json({ success: false, error: 'Use /api/v1/users/me instead' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch API keys' });
  }
});

router.post('/key', async (req: Request, res: any) => {
  try {
    res.status(501).json({ success: false, error: 'Use /api/v1/users/me instead' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create API key' });
  }
});

router.delete('/key/:id', async (req: Request, res: any) => {
  try {
    res.status(501).json({ success: false, error: 'Use /api/v1/users/me instead' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete API key' });
  }
});

export default router;
