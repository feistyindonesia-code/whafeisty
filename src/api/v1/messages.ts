import { Router } from 'express';
import { BaileysClient } from '../../services/whatsapp/baileys-client';
import {
  AccountModel,
  DeviceModel,
  MessageModel,
  PlatformSettingsModel,
  NoActiveMessageSubscriptionError,
  SendSafetyModel,
} from '../../services/database/models';
import { jwtAuth, customerOnly, AuthRequest } from '../../middleware/jwt';
import { checkSubscription } from '../../middleware/subscription';
import { Response } from 'express';
import { ApiResponse, SendMessageRequest } from '../../types';
import { resolveAccountMedia } from '../../services/media/storage';
import { apiKeyAuth, deviceOwnership, requireApiKeyScope } from '../../middleware/auth';

const router = Router();

function positiveLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function sendOutboundMessage(req: AuthRequest, res: Response<ApiResponse>) {
  try {
    const { device_id, to_number, content, media_id } = req.body as SendMessageRequest;

    if (
      typeof device_id !== 'string' ||
      typeof to_number !== 'string' ||
      !to_number.trim() ||
      (typeof content !== 'string' && content !== undefined) ||
      (typeof media_id !== 'string' && media_id !== undefined) ||
      req.body.media_url !== undefined ||
      (!content?.trim() && !media_id)
    ) {
      return res.status(400).json({ success: false, error: 'device_id, to_number, and content or media_id are required; remote media_url values are not supported' });
    }

    const device = await DeviceModel.findById(device_id);
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    if (device.connection_status !== 'connected') {
      return res.status(409).json({
        success: false,
        error: 'Device is not connected to WhatsApp. Connect the device and scan its pairing QR code before sending messages.',
      });
    }

    const accounts = await AccountModel.findByUserId(req.user.id);
    const account = accounts.find(a => a.id === device.account_id);
    if (!account) {
      return res.status(403).json({ success: false, error: 'Access denied to this device' });
    }
    if (media_id && !(await resolveAccountMedia(account.id, media_id))) {
      return res.status(404).json({ success: false, error: 'Media not found or access denied' });
    }

    const normalizedRecipient = to_number.trim().replace(/@s\.whatsapp\.net$/, '').replace(/^\+/, '');
    if (!/^\d{5,20}$/.test(normalizedRecipient)) {
      return res.status(400).json({ success: false, error: 'Recipient must be a phone number with 5 to 20 digits, including the country code' });
    }
    const platformSettings = await PlatformSettingsModel.getAll();
    const dailyLimit = positiveLimit(platformSettings.contact_daily_message_limit, 10);
    const weeklyLimit = positiveLimit(platformSettings.contact_weekly_message_limit, 30);
    const quotaResult = await MessageModel.withAtomicMonthlyQuota(req.user.id, async (_packageInfo, connection) => {
      const [consentRows] = await connection.execute(
        'SELECT * FROM contact_consents WHERE account_id = ? AND phone_number = ?',
        [account.id, normalizedRecipient]
      );
      const consent = (consentRows as any[])[0] || null;
      if (!consent || consent.status !== 'opted_in' || !consent.consented_at) {
        return { status: 403, body: {
            success: false,
            error: consent?.status === 'opted_out'
              ? 'Recipient opted out. Sending is blocked for this contact.'
              : 'No active consent recorded for this recipient. Record verifiable consent before sending.',
          } };
      }

      const safetyState = await SendSafetyModel.findByAccountId(account.id, connection);
      if (safetyState.paused_until && new Date(safetyState.paused_until) > new Date()) {
        return { status: 423, body: {
            success: false,
            error: 'Sending is temporarily paused after repeated delivery failures.',
            data: {
              paused_until: safetyState.paused_until,
              reason: safetyState.pause_reason,
            },
          } };
      }

      const [dailyRows] = await connection.execute(
        `SELECT COUNT(*) AS count FROM messages m
         JOIN devices d ON d.id = m.device_id
         WHERE d.account_id = ? AND m.to_number = ? AND m.direction = 'outbound'
           AND m.created_at >= ?`,
        [account.id, normalizedRecipient, new Date(Date.now() - 24 * 60 * 60 * 1000)]
      );
      const sentToday = Number((dailyRows as any[])[0].count);
      if (sentToday >= dailyLimit) {
        return { status: 429, body: { success: false, error: `Contact frequency limit reached (${dailyLimit} messages per rolling 24 hours)` } };
      }
      const [weeklyRows] = await connection.execute(
        `SELECT COUNT(*) AS count FROM messages m
         JOIN devices d ON d.id = m.device_id
         WHERE d.account_id = ? AND m.to_number = ? AND m.direction = 'outbound'
           AND m.created_at >= ?`,
        [account.id, normalizedRecipient, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)]
      );
      const sentThisWeek = Number((weeklyRows as any[])[0].count);
      if (sentThisWeek >= weeklyLimit) {
        return { status: 429, body: { success: false, error: `Contact frequency limit reached (${weeklyLimit} messages per rolling 7 days)` } };
      }

      const fromNumber = BaileysClient.getOwnNumber(device_id);
      let message;
      try {
        message = await MessageModel.create({
          from_number: fromNumber,
          to_number: normalizedRecipient,
          content: content || '',
          media_url: media_id,
          status: 'error',
          message_id: null,
          direction: 'outbound',
          device_id,
        }, connection);
      } catch (error) {
        console.error('Could not reserve message history before sending:', error);
        return { status: 500, body: { success: false, error: 'Message could not be safely recorded, so it was not sent' } };
      }

      return { status: 202, body: { success: true, data: { ...message, status: 'reserved' } }, message };
    });
    if (quotaResult.quotaExceeded) {
      return res.status(403).json({ success: false, error: 'Monthly message limit reached' });
    }
    const sendResult = quotaResult.result;
    if (!sendResult) {
      throw new Error('Message send operation did not return a result');
    }
    if (!sendResult.message) {
      return res.status(sendResult.status).json(sendResult.body as ApiResponse);
    }

    let providerResult;
    try {
      providerResult = await BaileysClient.sendMessage(
        device_id,
        normalizedRecipient,
        content || '',
        media_id ? { accountId: account.id, mediaId: media_id } : undefined
      );
    } catch (error) {
      console.error('WhatsApp send failed or outcome could not be confirmed:', error);
      const failureThreshold = positiveLimit(platformSettings.send_failure_pause_threshold, 5);
      const pauseMinutes = positiveLimit(platformSettings.send_failure_pause_minutes, 60);
      let failureState;
      try {
        failureState = await SendSafetyModel.recordFailure(account.id, failureThreshold, pauseMinutes);
      } catch (safetyError) {
        console.error('Could not update sending safety state after a provider failure:', safetyError);
        return res.status(502).json({
          success: false,
          error: 'WhatsApp send failed or its outcome could not be confirmed. The attempt is retained against quota, but the sending pause could not be updated. Do not retry until you verify whether the recipient received it.',
          data: {
            message_id: sendResult.message.id,
            safety_state_updated: false,
          },
        });
      }
      return res.status(502).json({
        success: false,
        error: 'WhatsApp send failed or its outcome could not be confirmed. The attempt is retained against quota. Do not retry until you verify whether the recipient received it.',
        data: {
          message_id: sendResult.message.id,
          consecutive_failures: failureState.consecutive_failures,
          paused_until: failureState.paused_until,
        },
      });
    }

    const providerMessageId = providerResult.key?.id || null;
    try {
      await MessageModel.updateOutboundStatus(sendResult.message.id, 'sent', providerMessageId);
    } catch (error) {
      console.error('WhatsApp accepted the message, but final message status could not be saved:', error);
      return res.status(500).json({
        success: false,
        error: 'WhatsApp accepted the message, but final message status could not be saved. Do not retry until you verify whether the recipient received it.',
        data: { message_id: sendResult.message.id },
      });
    }
    try {
      await SendSafetyModel.recordSuccess(account.id);
    } catch (error) {
      console.error('WhatsApp accepted the message, but sending safety state could not be reset:', error);
      return res.status(201).json({
        success: true,
        data: {
          ...sendResult.message,
          status: 'sent',
          message_id: providerMessageId,
          warning: 'Message sent, but the sending safety state could not be reset.',
        },
      });
    }
    return res.status(201).json({
      success: true,
      data: { ...sendResult.message, status: 'sent', message_id: providerMessageId },
    });
  } catch (error: any) {
    if (error instanceof NoActiveMessageSubscriptionError) {
      return res.status(403).json({ success: false, error: error.message });
    }
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: 'Failed to send message due to a server error' });
  }
}

router.post('/', jwtAuth, customerOnly, checkSubscription, sendOutboundMessage);
router.post(
  '/external',
  apiKeyAuth,
  requireApiKeyScope('messages:send'),
  checkSubscription,
  deviceOwnership,
  sendOutboundMessage
);

router.get(
  '/external/:deviceId',
  apiKeyAuth,
  requireApiKeyScope('messages:read'),
  checkSubscription,
  deviceOwnership,
  async (req: AuthRequest, res: Response<ApiResponse>) => {
    try {
      const requestedLimit = Number.parseInt(req.query.limit as string, 10);
      const requestedOffset = Number.parseInt(req.query.offset as string, 10);
      const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
      const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
      const messages = await MessageModel.findByDeviceId(req.params.deviceId, limit, offset);
      res.json({ success: true, data: messages });
    } catch (error) {
      console.error('External API message history fetch failed:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch messages' });
    }
  }
);

router.get('/safety', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const accounts = await AccountModel.findByUserId(req.user.id);
    if (accounts.length === 0) {
      return res.status(403).json({ success: false, error: 'No account found' });
    }
    const platformSettings = await PlatformSettingsModel.getAll();
    const state = await SendSafetyModel.findByAccountId(accounts[0].id);
    res.json({
      success: true,
      data: {
        consecutive_failures: Number(state.consecutive_failures),
        paused_until: state.paused_until,
        pause_reason: state.pause_reason,
        contact_daily_limit: positiveLimit(platformSettings.contact_daily_message_limit, 10),
        contact_weekly_limit: positiveLimit(platformSettings.contact_weekly_message_limit, 30),
      },
    });
  } catch (error) {
    console.error('Get message safety state error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch sending safety state' });
  }
});

router.post('/safety/resume', jwtAuth, customerOnly, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const accounts = await AccountModel.findByUserId(req.user.id);
    if (accounts.length === 0) {
      return res.status(403).json({ success: false, error: 'No account found' });
    }
    const state = await SendSafetyModel.findByAccountId(accounts[0].id);
    if (!state.paused_until || new Date(state.paused_until) <= new Date()) {
      return res.status(409).json({ success: false, error: 'Sending is not currently paused' });
    }
    if (typeof req.body.confirmed !== 'boolean' || !req.body.confirmed) {
      return res.status(400).json({ success: false, error: 'Explicit confirmation is required to resume sending' });
    }
    await SendSafetyModel.resume(accounts[0].id);
    res.json({ success: true });
  } catch (error) {
    console.error('Resume sending safety state error:', error);
    res.status(500).json({ success: false, error: 'Failed to resume sending' });
  }
});

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

    const requestedLimit = Number.parseInt(req.query.limit as string, 10);
    const requestedOffset = Number.parseInt(req.query.offset as string, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

    const messages = await MessageModel.findByDeviceId(deviceId, limit, offset);
    res.json({ success: true, data: messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

router.get('/:deviceId/:messageId', jwtAuth, customerOnly, checkSubscription, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const message = await MessageModel.findById(req.params.messageId);
    if (!message || message.device_id !== req.params.deviceId) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    const device = await DeviceModel.findById(message.device_id);
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    const accounts = await AccountModel.findByUserId(req.user.id);
    const account = accounts.find(a => a.id === device.account_id);
    if (!account) {
      return res.status(403).json({ success: false, error: 'Access denied to this device' });
    }

    res.json({ success: true, data: message });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch message' });
  }
});

export default router;
