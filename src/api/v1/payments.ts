import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { AdminAuditModel, PaymentModel, PackageModel, SubscriptionModel } from '../../services/database/models';
import { jwtAuth, customerOnly, superadminOnly, AuthRequest } from '../../middleware/jwt';
import { ApiResponse } from '../../types';
import { pool } from '../../services/database/connection';

const router = Router();
const privatePaymentDir = path.resolve(process.cwd(), 'private_uploads/payments');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(privatePaymentDir)) {
      fs.mkdirSync(privatePaymentDir, { recursive: true });
    }
    cb(null, privatePaymentDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.pdf': 'application/pdf',
    };
    const extension = path.extname(file.originalname).toLowerCase();
    const mimetype = allowedTypes[extension] === file.mimetype;
    if (mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

router.post('/upload', jwtAuth, customerOnly, upload.single('proof'), async (req: AuthRequest, res: any) => {
  try {
    const { package_id } = req.body;
    if (!package_id) {
      return res.status(400).json({ success: false, error: 'Package ID is required' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Payment proof is required' });
    }

    const pkg = await PackageModel.findById(package_id);
    if (!pkg || !pkg.active) {
      return res.status(404).json({ success: false, error: 'Package not found' });
    }

    const pendingSubscription = await SubscriptionModel.findPendingByUserAndPackage(req.user.id, package_id);
    if (!pendingSubscription) {
      await SubscriptionModel.create(req.user.id, package_id);
    }
    const payment = await PaymentModel.create(req.user.id, package_id, pkg.price, 'transfer', req.file.filename);

    res.status(201).json({ success: true, data: payment });
  } catch (error) {
    console.error('Upload payment error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload payment' });
  }
});

router.get('/me', jwtAuth, customerOnly, async (req: AuthRequest, res: any) => {
  try {
    const payments = await PaymentModel.findByUserId(req.user.id);
    res.json({ success: true, data: payments });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch payments' });
  }
});

router.get('/pending', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    const payments = await PaymentModel.findPending();
    res.json({ success: true, data: payments });
  } catch (error) {
    console.error('Get pending payments error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch pending payments' });
  }
});

router.get('/admin/history', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.id, p.user_id, p.package_id, p.amount, p.method, p.status,
         p.paid_at, p.verified_at, p.created_at, u.email, u.name,
         pk.name AS package_name, verifier.email AS verified_by_email
       FROM payments p
       JOIN users u ON u.id = p.user_id
       JOIN packages pk ON pk.id = p.package_id
       LEFT JOIN users verifier ON verifier.id = p.verified_by
       ORDER BY p.created_at DESC
       LIMIT 250`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Get admin payment history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch payment history' });
  }
});

router.get('/:id/proof', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    const payment = await PaymentModel.findById(req.params.id);
    if (!payment?.proof_url) {
      return res.status(404).json({ success: false, error: 'Payment proof not found' });
    }

    const filename = path.basename(String(payment.proof_url));
    const privatePath = path.join(privatePaymentDir, filename);
    const legacyPath = path.resolve(process.cwd(), 'uploads/payments', filename);
    const proofPath = fs.existsSync(privatePath) ? privatePath : legacyPath;
    if (!fs.existsSync(proofPath)) {
      return res.status(404).json({ success: false, error: 'Payment proof file not found' });
    }

    res.sendFile(proofPath);
  } catch (error) {
    console.error('Get payment proof error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch payment proof' });
  }
});

router.post('/:id/approve', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    const result = await PaymentModel.approveAndActivateSubscription(req.params.id, req.user.id);
    if (result === 'not_found') {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }
    if (result === 'already_processed') {
      return res.status(409).json({ success: false, error: 'Payment is no longer pending' });
    }
    if (result === 'subscription_not_found') {
      return res.status(409).json({ success: false, error: 'Pending subscription not found for this payment' });
    }
    if (result === 'package_not_found') {
      return res.status(404).json({ success: false, error: 'Package not found' });
    }
    await AdminAuditModel.record(req.user.id, 'payment_approved', 'payment', req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Approve payment error:', error);
    res.status(500).json({ success: false, error: 'Failed to approve payment' });
  }
});

router.post('/:id/reject', jwtAuth, superadminOnly, async (req: AuthRequest, res: any) => {
  try {
    const payment = await PaymentModel.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }
    if (payment.status !== 'pending') {
      return res.status(409).json({ success: false, error: 'Payment is no longer pending' });
    }
    const updated = await PaymentModel.updateStatus(req.params.id, 'rejected', req.user.id);
    if (!updated) {
      return res.status(409).json({ success: false, error: 'Payment is no longer pending' });
    }
    await AdminAuditModel.record(req.user.id, 'payment_rejected', 'payment', req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Reject payment error:', error);
    res.status(500).json({ success: false, error: 'Failed to reject payment' });
  }
});

export default router;
