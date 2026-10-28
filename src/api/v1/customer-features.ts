import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../../services/database/connection';
import { AccountModel, DeviceModel } from '../../services/database/models';
import { customerOnly, jwtAuth, requirePackageFeature, AuthRequest } from '../../middleware/jwt';
import { sendOutboundMessage } from './messages';

const router = Router();
const customerAuth = [jwtAuth, customerOnly] as const;

async function accountForUser(userId: string) {
  const accounts = await AccountModel.findByUserId(userId);
  return accounts[0] || null;
}

function validPhone(value: unknown): value is string {
  return typeof value === 'string' && /^\d{5,20}$/.test(value.trim().replace(/^\+/, ''));
}

router.get('/crm/contacts', ...customerAuth, requirePackageFeature('crm'), async (req: AuthRequest, res: any) => {
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '50'), 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(String(req.query.offset || '0'), 10) || 0, 0);
    const [rows] = await pool.execute(
      `SELECT id, phone_number, name, email, company, tags, notes, created_at, updated_at
       FROM crm_contacts
       WHERE account_id = ? AND (? = '' OR phone_number LIKE ? OR name LIKE ? OR email LIKE ? OR company LIKE ?)
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [account.id, search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, limit, offset]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('CRM contacts listing failed:', error);
    res.status(500).json({ success: false, error: 'Failed to list CRM contacts' });
  }
});

router.post('/crm/contacts', ...customerAuth, requirePackageFeature('crm'), async (req: AuthRequest, res: any) => {
  const phone = typeof req.body.phone_number === 'string'
    ? req.body.phone_number.trim().replace(/^\+/, '')
    : '';
  const { name, email, company, notes } = req.body;
  const tags = req.body.tags === undefined ? [] : req.body.tags;
  if (!validPhone(phone) ||
    (name !== undefined && (typeof name !== 'string' || name.length > 150)) ||
    (email !== undefined && (typeof email !== 'string' || email.length > 255)) ||
    (company !== undefined && (typeof company !== 'string' || company.length > 150)) ||
    (notes !== undefined && (typeof notes !== 'string' || notes.length > 5000)) ||
    !Array.isArray(tags) || tags.length > 30 ||
    tags.some((tag: unknown) => typeof tag !== 'string' || !tag.trim() || tag.length > 50)) {
    return res.status(400).json({ success: false, error: 'Invalid contact fields; tags must be up to 30 strings of at most 50 characters' });
  }
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO crm_contacts (id, account_id, phone_number, name, email, company, tags, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, account.id, phone, name?.trim() || null, email?.trim() || null, company?.trim() || null,
        JSON.stringify([...new Set(tags.map((tag: string) => tag.trim()))]), notes?.trim() || null]
    );
    res.status(201).json({ success: true, data: { id, phone_number: phone, name: name?.trim() || null, email: email?.trim() || null, company: company?.trim() || null, tags, notes: notes?.trim() || null } });
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, error: 'A CRM contact with this phone number already exists' });
    console.error('CRM contact creation failed:', error);
    res.status(500).json({ success: false, error: 'Failed to create CRM contact' });
  }
});

router.patch('/crm/contacts/:id', ...customerAuth, requirePackageFeature('crm'), async (req: AuthRequest, res: any) => {
  const allowed = ['name', 'email', 'company', 'notes', 'tags'];
  const entries = Object.entries(req.body || {});
  if (!entries.length || entries.some(([key]) => !allowed.includes(key))) {
    return res.status(400).json({ success: false, error: 'Provide supported CRM contact fields to update' });
  }
  const values: any[] = [];
  const updates: string[] = [];
  for (const [key, value] of entries) {
    if (key === 'tags') {
      if (!Array.isArray(value) || value.length > 30 || value.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 50)) {
        return res.status(400).json({ success: false, error: 'Invalid tags' });
      }
      updates.push('tags = ?');
      values.push(JSON.stringify([...new Set(value.map((tag: string) => tag.trim()))]));
    } else {
      const maxLength = key === 'notes' ? 5000 : key === 'email' ? 255 : 150;
      if (value !== null && (typeof value !== 'string' || value.length > maxLength)) {
        return res.status(400).json({ success: false, error: `Invalid ${key}` });
      }
      updates.push(`${key} = ?`);
      values.push(typeof value === 'string' ? value.trim() || null : null);
    }
  }
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    values.push(req.params.id, account.id);
    const [result] = await pool.execute(
      `UPDATE crm_contacts SET ${updates.join(', ')} WHERE id = ? AND account_id = ?`,
      values
    );
    if ((result as any).affectedRows !== 1) return res.status(404).json({ success: false, error: 'CRM contact not found' });
    const [rows] = await pool.execute(
      'SELECT id, phone_number, name, email, company, tags, notes, created_at, updated_at FROM crm_contacts WHERE id = ? AND account_id = ?',
      [req.params.id, account.id]
    );
    res.json({ success: true, data: (rows as any[])[0] });
  } catch (error) {
    console.error('CRM contact update failed:', error);
    res.status(500).json({ success: false, error: 'Failed to update CRM contact' });
  }
});

router.delete('/crm/contacts/:id', ...customerAuth, requirePackageFeature('crm'), async (req: AuthRequest, res: any) => {
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const [result] = await pool.execute('DELETE FROM crm_contacts WHERE id = ? AND account_id = ?', [req.params.id, account.id]);
    if ((result as any).affectedRows !== 1) return res.status(404).json({ success: false, error: 'CRM contact not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('CRM contact deletion failed:', error);
    res.status(500).json({ success: false, error: 'Failed to delete CRM contact' });
  }
});

router.get('/broadcast/campaigns', ...customerAuth, requirePackageFeature('broadcast'), async (req: AuthRequest, res: any) => {
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const [rows] = await pool.execute(
      `SELECT c.*, d.device_id AS whatsapp_device_id,
        (SELECT COUNT(*) FROM broadcast_recipients r WHERE r.campaign_id = c.id) AS prepared_recipients
       FROM broadcast_campaigns c JOIN devices d ON d.id = c.device_id
       WHERE c.account_id = ? ORDER BY c.created_at DESC LIMIT 100`,
      [account.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Broadcast campaign listing failed:', error);
    res.status(500).json({ success: false, error: 'Failed to list campaigns' });
  }
});

router.post('/broadcast/campaigns', ...customerAuth, requirePackageFeature('broadcast'), async (req: AuthRequest, res: any) => {
  const { name, device_id, content } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.length > 150 ||
    typeof device_id !== 'string' || typeof content !== 'string' || !content.trim() || content.length > 4000) {
    return res.status(400).json({ success: false, error: 'Campaign name, device_id, and message content (max 4000 characters) are required' });
  }
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const device = await DeviceModel.findById(device_id);
    if (!device || device.account_id !== account.id) return res.status(404).json({ success: false, error: 'Device not found' });
    const id = uuidv4();
    await pool.execute(
      'INSERT INTO broadcast_campaigns (id, account_id, device_id, name, content) VALUES (?, ?, ?, ?, ?)',
      [id, account.id, device_id, name.trim(), content.trim()]
    );
    res.status(201).json({ success: true, data: { id, name: name.trim(), device_id, content: content.trim(), status: 'draft', recipient_count: 0 } });
  } catch (error) {
    console.error('Broadcast campaign creation failed:', error);
    res.status(500).json({ success: false, error: 'Failed to create campaign' });
  }
});

router.get('/broadcast/campaigns/:id/preview', ...customerAuth, requirePackageFeature('broadcast'), async (req: AuthRequest, res: any) => {
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const [campaignRows] = await pool.execute(
      'SELECT id, device_id, name, content, status FROM broadcast_campaigns WHERE id = ? AND account_id = ?',
      [req.params.id, account.id]
    );
    const campaign = (campaignRows as any[])[0];
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
    const [recipients] = await pool.execute(
      `SELECT c.phone_number, c.name, c.purpose AS consent_purpose, c.consented_at
       FROM contact_consents c
       WHERE c.account_id = ? AND c.status = 'opted_in' AND c.consented_at IS NOT NULL
       ORDER BY c.phone_number LIMIT 1000`,
      [account.id]
    );
    const [safetyRows] = await pool.execute('SELECT paused_until FROM send_safety_states WHERE account_id = ?', [account.id]);
    const pausedUntil = (safetyRows as any[])[0]?.paused_until || null;
    res.json({
      success: true,
      data: {
        campaign,
        eligible_count: (recipients as any[]).length,
        recipients,
        sending_paused: Boolean(pausedUntil && new Date(pausedUntil) > new Date()),
        paused_until: pausedUntil,
        send_enabled: false,
        note: 'Preview only; queued delivery worker is not enabled. No WhatsApp messages were sent.',
      },
    });
  } catch (error) {
    console.error('Broadcast preview failed:', error);
    res.status(500).json({ success: false, error: 'Failed to preview campaign recipients' });
  }
});

router.post('/broadcast/campaigns/:id/prepare', ...customerAuth, requirePackageFeature('broadcast'), async (req: AuthRequest, res: any) => {
  const connection = await pool.getConnection();
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    await connection.beginTransaction();
    const [campaignRows] = await connection.execute(
      'SELECT id, status FROM broadcast_campaigns WHERE id = ? AND account_id = ? FOR UPDATE',
      [req.params.id, account.id]
    );
    const campaign = (campaignRows as any[])[0];
    if (!campaign) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }
    if (campaign.status !== 'draft') {
      await connection.rollback();
      return res.status(409).json({ success: false, error: 'Only draft campaigns can be prepared' });
    }
    const [recipients] = await connection.execute(
      `SELECT phone_number FROM contact_consents
       WHERE account_id = ? AND status = 'opted_in' AND consented_at IS NOT NULL
       ORDER BY phone_number LIMIT 1000`,
      [account.id]
    );
    const preparedAt = new Date();
    for (const recipient of recipients as any[]) {
      await connection.execute(
        `INSERT INTO broadcast_recipients (id, campaign_id, account_id, phone_number, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [uuidv4(), campaign.id, account.id, recipient.phone_number]
      );
    }
    await connection.execute(
      `UPDATE broadcast_campaigns SET status = 'ready', recipient_count = ? WHERE id = ? AND account_id = ?`,
      [(recipients as any[]).length, campaign.id, account.id]
    );
    await connection.commit();
    res.json({
      success: true,
      data: {
        campaign_id: campaign.id,
        prepared_recipients: (recipients as any[]).length,
        prepared_at: preparedAt,
        delivery_enabled: false,
        note: 'Recipients are snapshotted only; no WhatsApp messages were sent.',
      },
    });
  } catch (error) {
    await connection.rollback();
    console.error('Broadcast recipient preparation failed:', error);
    res.status(500).json({ success: false, error: 'Failed to prepare campaign recipients' });
  } finally {
    connection.release();
  }
});

router.get('/automations', ...customerAuth, requirePackageFeature('automessage'), async (req: AuthRequest, res: any) => {
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const [rows] = await pool.execute(
      'SELECT id, name, trigger_type, keyword, reply_text, enabled, created_at, updated_at FROM automation_rules WHERE account_id = ? ORDER BY created_at DESC',
      [account.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Automation listing failed:', error);
    res.status(500).json({ success: false, error: 'Failed to list automation rules' });
  }
});

router.post('/automations', ...customerAuth, requirePackageFeature('automessage'), async (req: AuthRequest, res: any) => {
  const { name, keyword, reply_text } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.length > 150 ||
    typeof keyword !== 'string' || !keyword.trim() || keyword.length > 100 ||
    typeof reply_text !== 'string' || !reply_text.trim() || reply_text.length > 2000) {
    return res.status(400).json({ success: false, error: 'Name, keyword, and reply text are required and must be within documented limits' });
  }
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO automation_rules (id, account_id, name, keyword, reply_text, enabled)
       VALUES (?, ?, ?, ?, ?, false)`,
      [id, account.id, name.trim(), keyword.trim().toLowerCase(), reply_text.trim()]
    );
    res.status(201).json({ success: true, data: { id, name: name.trim(), keyword: keyword.trim().toLowerCase(), reply_text: reply_text.trim(), enabled: false } });
  } catch (error) {
    console.error('Automation rule creation failed:', error);
    res.status(500).json({ success: false, error: 'Failed to create automation rule' });
  }
});

router.patch('/automations/:id', ...customerAuth, requirePackageFeature('automessage'), async (req: AuthRequest, res: any) => {
  const { name, keyword, reply_text } = req.body;
  if (Object.keys(req.body || {}).some((key) => !['name', 'keyword', 'reply_text', 'enabled'].includes(key)) ||
    Object.keys(req.body || {}).length === 0 ||
    (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 150)) ||
    (keyword !== undefined && (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 100)) ||
    (reply_text !== undefined && (typeof reply_text !== 'string' || !reply_text.trim() || reply_text.length > 2000)) ||
    (req.body.enabled !== undefined && typeof req.body.enabled !== 'boolean')) {
    return res.status(400).json({ success: false, error: 'Invalid automation fields' });
  }
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const [result] = await pool.execute(
      `UPDATE automation_rules SET
         name = COALESCE(?, name), keyword = COALESCE(?, keyword),
         reply_text = COALESCE(?, reply_text), enabled = COALESCE(?, enabled)
       WHERE id = ? AND account_id = ?`,
      [name?.trim() || null, keyword?.trim().toLowerCase() || null, reply_text?.trim() || null,
        req.body.enabled === undefined ? null : req.body.enabled, req.params.id, account.id]
    );
    if ((result as any).affectedRows !== 1) return res.status(404).json({ success: false, error: 'Automation rule not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Automation rule update failed:', error);
    res.status(500).json({ success: false, error: 'Failed to update automation rule' });
  }
});

router.delete('/automations/:id', ...customerAuth, requirePackageFeature('automessage'), async (req: AuthRequest, res: any) => {
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const [result] = await pool.execute('DELETE FROM automation_rules WHERE id = ? AND account_id = ?', [req.params.id, account.id]);
    if ((result as any).affectedRows !== 1) return res.status(404).json({ success: false, error: 'Automation rule not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Automation deletion failed:', error);
    res.status(500).json({ success: false, error: 'Failed to delete automation rule' });
  }
});

router.get('/customer-service/conversations', ...customerAuth, requirePackageFeature('customer_service'), async (req: AuthRequest, res: any) => {
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const [rows] = await pool.execute(
      `SELECT m.from_number AS phone_number, m.device_id, m.content AS last_message,
         m.created_at AS last_message_at, m.direction,
         c.status AS consent_status
       FROM messages m
       JOIN devices d ON d.id = m.device_id
       LEFT JOIN contact_consents c ON c.account_id = d.account_id AND c.phone_number = m.from_number
       WHERE d.account_id = ?
         AND m.id IN (
           SELECT latest.id FROM messages latest
           JOIN devices ld ON ld.id = latest.device_id
           WHERE ld.account_id = ? AND latest.direction = 'inbound'
             AND latest.created_at = (
               SELECT MAX(last_msg.created_at) FROM messages last_msg
               WHERE last_msg.device_id = latest.device_id
                 AND last_msg.direction = 'inbound'
                 AND last_msg.from_number = latest.from_number
             )
         )
       ORDER BY m.created_at DESC LIMIT 100`,
      [account.id, account.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Customer service inbox listing failed:', error);
    res.status(500).json({ success: false, error: 'Failed to list conversations' });
  }
});

router.get('/customer-service/conversations/:phone/messages', ...customerAuth, requirePackageFeature('customer_service'), async (req: AuthRequest, res: any) => {
  if (!validPhone(req.params.phone)) return res.status(400).json({ success: false, error: 'Invalid phone number' });
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const phone = req.params.phone.replace(/^\+/, '');
    const [rows] = await pool.execute(
      `SELECT m.* FROM messages m JOIN devices d ON d.id = m.device_id
       WHERE d.account_id = ? AND (m.from_number = ? OR m.to_number = ?)
       ORDER BY m.created_at DESC LIMIT 100`,
      [account.id, phone, phone]
    );
    res.json({ success: true, data: (rows as any[]).reverse() });
  } catch (error) {
    console.error('Customer service message history failed:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch conversation messages' });
  }
});

router.post('/customer-service/reply', ...customerAuth, requirePackageFeature('customer_service'), async (req: AuthRequest, res: any) => {
  await sendOutboundMessage(req, res);
});

router.get('/advertising/campaigns', ...customerAuth, requirePackageFeature('advertising'), async (req: AuthRequest, res: any) => {
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const [rows] = await pool.execute(
      'SELECT * FROM advertising_campaigns WHERE account_id = ? ORDER BY created_at DESC LIMIT 100',
      [account.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Advertising campaign listing failed:', error);
    res.status(500).json({ success: false, error: 'Failed to list advertising campaigns' });
  }
});

router.post('/advertising/campaigns', ...customerAuth, requirePackageFeature('advertising'), async (req: AuthRequest, res: any) => {
  const { name, platform, objective, landing_url, budget } = req.body;
  const parsedBudget = Number(budget);
  if (typeof name !== 'string' || !name.trim() || name.length > 150 ||
    !['meta', 'google', 'other'].includes(platform) ||
    typeof objective !== 'string' || !objective.trim() || objective.length > 100 ||
    (landing_url !== undefined && landing_url !== null && (typeof landing_url !== 'string' || landing_url.length > 2048)) ||
    !Number.isFinite(parsedBudget) || parsedBudget < 0 || parsedBudget > 1_000_000_000) {
    return res.status(400).json({ success: false, error: 'Invalid advertising campaign fields' });
  }
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const id = uuidv4();
    await pool.execute(
      `INSERT INTO advertising_campaigns
        (id, account_id, name, platform, objective, landing_url, budget)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, account.id, name.trim(), platform, objective.trim(), landing_url || null, parsedBudget]
    );
    res.status(201).json({ success: true, data: { id, name: name.trim(), platform, objective: objective.trim(), landing_url: landing_url || null, budget: parsedBudget, status: 'draft' } });
  } catch (error) {
    console.error('Advertising campaign creation failed:', error);
    res.status(500).json({ success: false, error: 'Failed to create advertising campaign' });
  }
});

router.patch('/advertising/campaigns/:id/status', ...customerAuth, requirePackageFeature('advertising'), async (req: AuthRequest, res: any) => {
  const { status } = req.body;
  if (!['draft', 'active', 'paused', 'completed'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid advertising campaign status' });
  }
  try {
    const account = await accountForUser(req.user.id);
    if (!account) return res.status(403).json({ success: false, error: 'No account found' });
    const [result] = await pool.execute(
      'UPDATE advertising_campaigns SET status = ? WHERE id = ? AND account_id = ?',
      [status, req.params.id, account.id]
    );
    if ((result as any).affectedRows !== 1) return res.status(404).json({ success: false, error: 'Advertising campaign not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Advertising status update failed:', error);
    res.status(500).json({ success: false, error: 'Failed to update advertising campaign' });
  }
});

export default router;
