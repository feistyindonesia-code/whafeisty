import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initializeSchema } from './services/database/connection';
import { apiKeyAuth } from './middleware/auth';
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
import { UserModel, DeviceModel, AccountModel } from './services/database/models';
import jwt from 'jsonwebtoken';
import P from 'pino';
import path from 'path';
import fs from 'fs';

dotenv.config();

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Initialize database schema
initializeSchema().catch((err) => {
  console.error('Failed to initialize database schema:', err);
});

const logger = P({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

const app = express();