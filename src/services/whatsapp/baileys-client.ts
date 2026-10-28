import { makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } from 'baileys';
import { ContactConsentModel, DeviceModel, MessageModel } from '../database/models';
import type { Device } from '../../types';
import P from 'pino';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import path from 'path';
import { resolveAccountMedia } from '../media/storage';

dotenv.config();

const logger = P({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

function normalizePhoneJid(jid: unknown): string | null {
  if (typeof jid !== 'string' || !jid.endsWith('@s.whatsapp.net')) {
    return null;
  }
  const phone = jid.slice(0, -'@s.whatsapp.net'.length).split(':')[0];
  return /^\d{5,20}$/.test(phone) ? phone : null;
}

function getMessageText(message: any): string {
  const content = message?.ephemeralMessage?.message
    || message?.viewOnceMessage?.message
    || message?.viewOnceMessageV2?.message
    || message;
  return content?.conversation
    || content?.extendedTextMessage?.text
    || content?.imageMessage?.caption
    || content?.videoMessage?.caption
    || content?.documentMessage?.caption
    || content?.buttonsResponseMessage?.selectedDisplayText
    || content?.listResponseMessage?.title
    || content?.templateButtonReplyMessage?.selectedDisplayText
    || '';
}

function isOptOutMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?,;:]+$/g, '').replace(/\s+/g, ' ');
  return /^(stop|stop all|unsubscribe|unsubscribe all|cancel|quit|end|remove|opt out|opt-out|berhenti|jangan kirim|berhenti berlangganan)$/.test(normalized);
}

export class BaileysClient {
  private static instances: Map<string, any> = new Map();
  private static qrCodes: Map<string, string> = new Map();
  private static sessionDir: string = process.env.WA_SESSION_DIR || './sessions';

  static async restoreDevices(): Promise<void> {
    const devices = await DeviceModel.findAll();
    for (const device of devices) {
      try {
        await this.startDevice(device);
      } catch (error) {
        logger.error({ err: error, deviceId: device.id }, 'Failed to restore WhatsApp device');
        await DeviceModel.updateStatus(device.id, 'offline', 'disconnected');
      }
    }
    logger.info(`Restored ${devices.length} WhatsApp device session(s)`);
  }

  static async createDevice(accountId: string): Promise<Device> {
    const device = await DeviceModel.create(accountId);
    try {
      await this.startDevice(device);
    } catch (error) {
      await DeviceModel.delete(device.id);
      throw error;
    }
    return device;
  }

  static async connectDevice(deviceId: string): Promise<Device> {
    const device = await DeviceModel.findById(deviceId);
    if (!device) {
      throw new Error('Device not found');
    }
    try {
      await this.startDevice(device);
    } catch (error) {
      await DeviceModel.updateStatus(deviceId, 'offline', 'disconnected');
      throw error;
    }
    return device;
  }

  private static async startDevice(device: Device): Promise<void> {
    const deviceId = device.id;
    if (this.instances.has(deviceId)) {
      return;
    }
    await DeviceModel.updateStatus(deviceId, 'offline', 'connecting');
    const sessionPath = `${this.sessionDir}/${deviceId}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })),
      },
      printQRInTerminal: false,
      logger,
      browser: ['Whafeisty API', 'Chrome', '1.0.0'],
    });

    this.instances.set(deviceId, sock);

    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrDataUrl = await QRCode.toDataURL(qr);
        this.qrCodes.set(deviceId, qrDataUrl);
        logger.info(`QR code generated for device ${deviceId}`);
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        const shouldManageReconnect = this.instances.get(deviceId) === sock;
        logger.info(`Device ${deviceId} disconnected. Reconnecting: ${shouldReconnect}`);

        if (shouldManageReconnect) {
          this.instances.delete(deviceId);
        }
        this.qrCodes.delete(deviceId);
        await DeviceModel.updateStatus(deviceId, 'offline', 'disconnected');

        if (shouldReconnect && shouldManageReconnect) {
          setTimeout(() => {
            this.connectDevice(deviceId).catch((error) => {
              logger.error({ err: error, deviceId }, 'Failed to reconnect device');
            });
          }, 5000);
        }
      } else if (connection === 'open') {
        this.qrCodes.delete(deviceId);
        logger.info(`Device ${deviceId} connected`);
        await DeviceModel.updateStatus(deviceId, 'online', 'connected');

        // Get device ID from connection
        const deviceIdWA = sock.user?.id?.split(':')[0] || '';
        if (deviceIdWA) {
          await DeviceModel.updateDeviceId(deviceId, deviceIdWA);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m: any) => {
      try {
        const deviceRecord = await DeviceModel.findById(deviceId);
        if (!deviceRecord) {
          logger.error({ deviceId }, 'Received inbound messages for an unknown device');
          return;
        }

        for (const msg of m.messages) {
          if (!msg.key.remoteJid || msg.key.fromMe || msg.key.remoteJid.endsWith('@g.us')) continue;

          const senderJid = msg.key.remoteJidAlt || msg.key.remoteJid;
          const fromNumber = normalizePhoneJid(senderJid);
          const toNumber = normalizePhoneJid(sock.user?.id);
          const text = getMessageText(msg.message);
          if (fromNumber && isOptOutMessage(text)) {
            await ContactConsentModel.revokeConsent({
              accountId: deviceRecord.account_id,
              phoneNumber: fromNumber,
              source: 'whatsapp_inbound',
              evidence: `Recipient opt-out message received: ${text.trim().slice(0, 500)}`,
            });
            logger.info({ deviceId, fromNumber }, 'Contact consent revoked by inbound opt-out');
          }

          let savedMessage = null;
          if (fromNumber && toNumber) {
            try {
              savedMessage = await MessageModel.create({
                from_number: fromNumber,
                to_number: toNumber,
                content: text,
                status: 'sent',
                message_id: msg.key.id || null,
                direction: 'inbound',
                device_id: deviceId,
              });
            } catch (error) {
              logger.error({ err: error, deviceId, messageId: msg.key.id }, 'Failed to persist inbound message');
            }
          } else {
            logger.warn({ deviceId, remoteJid: msg.key.remoteJid }, 'Inbound message has no resolvable phone JID; skipped history persistence');
          }

          const io = (global as any).io;
          if (io) {
            io.to(`device:${deviceId}`).emit('message.inbound', savedMessage || {
              from_number: fromNumber || senderJid,
              to_number: toNumber || '',
              content: text,
              status: 'sent',
              message_id: msg.key.id,
              direction: 'inbound',
              device_id: deviceId,
            });
          }
        }
      } catch (error) {
        logger.error({ err: error, deviceId }, 'Failed to process inbound WhatsApp messages');
      }
    });
  }

  static getDeviceSocket(deviceId: string): any {
    return this.instances.get(deviceId);
  }

  static getOwnNumber(deviceId: string): string {
    const sock = this.instances.get(deviceId);
    const jid = sock?.user?.id;
    if (!jid || typeof jid !== 'string') {
      throw new Error('Device is not connected');
    }
    return jid.split('@')[0].split(':')[0];
  }

  static async getQRCode(deviceId: string): Promise<string | null> {
    return this.qrCodes.get(deviceId) || null;
  }

  static async getQRCodeFromDevice(deviceId: string): Promise<string | null> {
    return this.getQRCode(deviceId);
  }

  static async disconnectDevice(deviceId: string): Promise<void> {
    const sock = this.instances.get(deviceId);
    if (sock) {
      this.instances.delete(deviceId);
      this.qrCodes.delete(deviceId);
      await sock.logout();
      sock.end();
    }
    await DeviceModel.updateStatus(deviceId, 'offline', 'disconnected');
  }

  static async sendMessage(
    deviceId: string,
    toNumber: string,
    content: string,
    media?: { accountId: string; mediaId: string }
  ): Promise<any> {
    const sock = this.instances.get(deviceId);
    if (!sock || !sock.user) {
      throw new Error('Device not connected');
    }

    const recipient = toNumber.trim().replace(/@s\.whatsapp\.net$/, '');
    if (!/^\+?\d{5,20}$/.test(recipient)) {
      throw new Error('Recipient number must contain 5 to 20 digits');
    }
    const normalizedRecipient = recipient.replace(/^\+/, '');
    const jid = `${normalizedRecipient}@s.whatsapp.net`;

    let result;
    if (media) {
      const mediaPath = await resolveAccountMedia(media.accountId, media.mediaId);
      if (!mediaPath) {
        throw new Error('Media not found or access denied');
      }
      const extension = path.extname(mediaPath).toLowerCase();
      const mediaKind = extension === '.mp4'
        ? 'video'
        : extension === '.mp3'
          ? 'audio'
          : extension === '.pdf'
            ? 'document'
            : 'image';
      const mimeType = extension === '.jpg'
        ? 'image/jpeg'
        : extension === '.png'
          ? 'image/png'
          : extension === '.gif'
            ? 'image/gif'
            : extension === '.mp4'
              ? 'video/mp4'
              : extension === '.mp3'
                ? 'audio/mpeg'
                : 'application/pdf';
      result = await sock.sendMessage(jid, {
        [mediaKind]: { url: mediaPath },
        ...(mediaKind === 'audio' ? { mimetype: mimeType, ptt: false } : {}),
        ...(mediaKind === 'document' ? { mimetype: mimeType, fileName: path.basename(mediaPath) } : {}),
        ...(['image', 'video'].includes(mediaKind) && content ? { caption: content } : {}),
      });
    } else {
      result = await sock.sendMessage(jid, { text: content });
    }

    return result;
  }

  static async getContacts(deviceId: string): Promise<any[]> {
    const sock = this.instances.get(deviceId);
    if (!sock) {
      throw new Error('Device not connected');
    }

    const contacts = await sock.getAllContacts();
    return Object.values(contacts).map((contact: any) => ({
      id: contact.id,
      name: contact.name || contact.verifiedName || '',
      phone: contact.id.split(':')[0],
    }));
  }
}
