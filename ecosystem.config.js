const dotenv = require('dotenv');
const path = require('path');

// Load environment from .env file in project root
dotenv.config({ path: path.resolve(__dirname, '.env') });

module.exports = {
  apps: [
    {
      name: 'whafeistyapp-api',
      script: 'dist/app.js',
      cwd: process.cwd(),
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        PORT: process.env.PORT || 4000,
        WS_PORT: process.env.WS_PORT || 4001,
        JWT_SECRET: process.env.JWT_SECRET,
        API_KEY_PREFIX: process.env.API_KEY_PREFIX || 'whap_',
        MAX_DEVICES_PER_ACCOUNT: process.env.MAX_DEVICES_PER_ACCOUNT || 5,
        WA_SESSION_DIR: process.env.WA_SESSION_DIR || './sessions',
        WA_AUTH_TIMEOUT: process.env.WA_AUTH_TIMEOUT || 30000,
        DB_HOST: process.env.DB_HOST || 'localhost',
        DB_PORT: process.env.DB_PORT || 3306,
        DB_USER: process.env.DB_USER || 'whatsapp_user',
        DB_PASSWORD: process.env.DB_PASSWORD,
        DB_NAME: process.env.DB_NAME || 'whatsapp_api',
        REDIS_HOST: process.env.REDIS_HOST || 'localhost',
        REDIS_PORT: process.env.REDIS_PORT || 6379,
        FRONTEND_URL: process.env.FRONTEND_URL,
        APP_URL: process.env.APP_URL || 'http://localhost:4000',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 4000,
        WS_PORT: process.env.WS_PORT || 4001,
        JWT_SECRET: process.env.JWT_SECRET,
        API_KEY_PREFIX: process.env.API_KEY_PREFIX || 'whap_',
        MAX_DEVICES_PER_ACCOUNT: process.env.MAX_DEVICES_PER_ACCOUNT || 5,
        WA_SESSION_DIR: process.env.WA_SESSION_DIR || './sessions',
        WA_AUTH_TIMEOUT: process.env.WA_AUTH_TIMEOUT || 30000,
        DB_HOST: process.env.DB_HOST || 'localhost',
        DB_PORT: process.env.DB_PORT || 3306,
        DB_USER: process.env.DB_USER || 'whatsapp_user',
        DB_PASSWORD: process.env.DB_PASSWORD,
        DB_NAME: process.env.DB_NAME || 'whatsapp_api',
        REDIS_HOST: process.env.REDIS_HOST || 'localhost',
        REDIS_PORT: process.env.REDIS_PORT || 6379,
        FRONTEND_URL: process.env.FRONTEND_URL,
        APP_URL: process.env.APP_URL || 'http://localhost:4000',
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      max_memory_restart: '1G',
      restart_delay: 5000,
      watch: false,
    },
  ],
};
