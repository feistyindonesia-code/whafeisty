// Entry point for Passenger/RumahWeb Node.js hosting
// This file is picked up automatically by Phusion Passenger

require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Ensure sessions directory exists
const sessionsDir = process.env.WA_SESSION_DIR || './sessions';
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// Load the compiled app
const app = require('./dist/app.js');

module.exports = app;
