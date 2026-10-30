import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { assertDatabaseSchemaCurrent } from './services/database/connection';
import jwt from 'jsonwebtoken';
import { AccountModel, DeviceModel, UserModel } from './services/database/models';
import authRoutes from './api/v1/auth';
import userRoutes from './api/v1/users';
import packageRoutes from './api/v1/packages';
import subscriptionRoutes from './api/v1/subscriptions';
import paymentRoutes from './api/v1/payments';
import deviceRoutes from './api/v1/devices';
import messageRoutes from './api/v1/messages';
import contactRoutes from './api/v1/contacts';
import webhookRoutes from './api/v1/webhooks';
import groupRoutes from './api/v1/groups';
import mediaRoutes from './api/v1/media';
import usageRoutes from './api/v1/usage';
import settingsRoutes from './api/v1/settings';
import customerFeatureRoutes from './api/v1/customer-features';
import { BaileysClient } from './services/whatsapp/baileys-client';
import P from 'pino';
import path from 'path';
import fs from 'fs';

const logger = P({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

function validateEnv(): void {
  const required: { key: string; label: string }[] = [
    { key: 'DB_PASSWORD', label: 'Database password' },
    { key: 'JWT_SECRET', label: 'JWT secret' },
  ];
  const missing: string[] = [];
  for (const { key, label } of required) {
    const value = process.env[key];
    if (!value || value.length < 32) {
      missing.push(`${label} (${key}) must be set to a value of at least 32 characters`);
    }
  }
  if (missing.length > 0) {
    for (const msg of missing) {
      logger.error(msg);
    }
    process.exit(1);
  }
}

validateEnv();

const allowedOrigin = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? false : '*');
const trustedProxies = (process.env.TRUST_PROXY || '')
  .split(',')
  .map((proxy) => proxy.trim())
  .filter(Boolean);

if (trustedProxies.some((proxy) => proxy === '*' || proxy.toLowerCase() === 'true')) {
  throw new Error('TRUST_PROXY must list explicit trusted proxy IPs or subnets; wildcard/boolean trust is unsafe');
}

const app = express();

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

app.set('trust proxy', trustedProxies.length ? trustedProxies : false);

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
  },
});

(global as any).io = io;

app.use(cors({ origin: allowedOrigin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads/payments', (req, res) => {
  res.sendStatus(404);
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/packages', packageRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/v1/messages', messageRoutes);
app.use('/api/v1/contacts', contactRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/groups', groupRoutes);
app.use('/api/v1/media', mediaRoutes);
app.use('/api/v1/usage', usageRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/features', customerFeatureRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    return next(error);
  }
  logger.error({ err: error, method: req.method, path: req.path }, 'Unhandled request error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !process.env.JWT_SECRET) {
      return next(new Error('Authentication required'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as jwt.JwtPayload;
    if (typeof decoded.sub !== 'string' && typeof decoded.id !== 'string') {
      return next(new Error('Invalid token'));
    }
    const user = await UserModel.findById(String(decoded.sub || decoded.id));
    if (!user || Number(decoded.tokenVersion || 0) !== Number(user.auth_token_version || 0)) {
      return next(new Error('Invalid token'));
    }
    socket.data.user = user;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  logger.info('Client connected to WebSocket');

  socket.on('device.subscribe', async (deviceId: string) => {
    try {
      if (typeof deviceId !== 'string' || socket.data.user?.role !== 'customer') {
        return;
      }
      const device = await DeviceModel.findById(deviceId);
      if (!device) {
        return;
      }
      const accounts = await AccountModel.findByUserId(socket.data.user.id);
      if (!accounts.some((account) => account.id === device.account_id)) {
        return;
      }
      await socket.join(`device:${deviceId}`);
      logger.info(`Client subscribed to device ${deviceId}`);
    } catch (error) {
      logger.error({ err: error }, 'Failed to subscribe WebSocket client to device');
    }
  });

  socket.on('device.unsubscribe', (deviceId: string) => {
    if (typeof deviceId !== 'string') {
      return;
    }
    socket.leave(`device:${deviceId}`);
    logger.info(`Client unsubscribed from device ${deviceId}`);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected from WebSocket');
  });
});

const PORT = process.env.PORT || 4000;

async function startServer() {
  try {
    await assertDatabaseSchemaCurrent();
    logger.info('Database schema migrations verified');
    await BaileysClient.restoreDevices();

    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`WebSocket server available on port ${PORT}`);
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

startServer();
