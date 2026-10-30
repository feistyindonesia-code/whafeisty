# Production Readiness Plan - Whafeisty App

## Current State

- Backend runs on Node.js 20 with Express + TypeScript
- Frontend is React 18 + Vite build (separate)
- MySQL for data, Redis for cache/queue
- Socket.IO on same port (4000) as HTTP
- Dockerfile exists but only bundles backend (no frontend)
- PM2 ecosystem config exists but with hardcoded secrets

## Critical Issues to Address

### 1. Database Schema Initialization Conflict
**Problem**: README states "The API no longer creates or changes schema at startup; run migrations before starting it." But `app.ts:36` still calls `initializeSchema()` at startup.

**Action**: Remove or guard the `initializeSchema()` call in `app.ts` - rely on `npm run migrate` only.

### 2. Environment Validation Missing
**Problem**: App starts with placeholder `.env` values (e.g., `JWT_SECRET=your_production_jwt_secret...`, empty `DB_PASSWORD`).

**Action**: Add `dotenv-safe` or custom validation at startup to fail fast on:
- Missing DB_PASSWORD
- Missing/weak JWT_SECRET (must be 64+ hex chars)
- Missing SUPERADMIN credentials
- SMTP settings for production

### 3. CORS & Frontend Build
**Problem**: Dockerfile only builds/serves backend. Frontend needs to be built and nginx-served or reverse-proxied.

**Action**: Create separate `frontend/Dockerfile` and add nginx reverse proxy service to docker-compose.

### 4. PM2 Ecosystem Hardcoded Secrets
**Problem**: `ecosystem.config.js` has hardcoded `DB_USER: 'whatsapp_user'`, `DB_PASSWORD: 'secure_password'`.

**Action**: Make PM2 config read from actual `.env` file or environment variables only.

### 5. JWT Secret Validation
**Problem**: Weak/placeholder JWT secret in committed `.env`.

**Action**: Generate proper secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and update `.env`.

## Pre-Production Checklist

### Infrastructure
- [ ] MySQL 8 running with `whatsapp_api` database
- [ ] Redis 7 running  
- [ ] Domain + HTTPS configured
- [ ] `TRUST_PROXY` set to reverse proxy IP
- [ ] `FRONTEND_URL` set to production frontend URL
- [ ] Ports 4000 (API), 4001 (WS) open

### Security
- [ ] `JWT_SECRET` is 64+ hex chars (regenerate, don't commit)
- [ ] `SUPERADMIN_PASSWORD` is 12+ chars
- [ ] `DB_PASSWORD` set (not empty)
- [ ] `SMTP_SECURE=true` for production SMTP
- [ ] Rate limiting verified (login: 10 attempts/15min/IP, register: 5/hour/IP)

### Data
- [ ] Run migrations: `npm run migrate`
- [ ] Create SuperAdmin: `npm run create-superadmin`
- [ ] Seed packages via API: `POST /api/v1/packages` (superadmin)

## Deployment Steps

```bash
# 1. Build backend
npm run build

# 2. Run migrations (ONCE)
npm run migrate

# 3. Create SuperAdmin (ONCE)
npm run create-superadmin

# 4. Start with PM2
pm2 start ecosystem.config.js --env production

# 5. Save & setup startup
pm2 save
pm2 startup

# 6. For frontend (separate)
cd frontend
npm run build
# Serve dist/ via nginx or similar
```

## Validation Steps

1. **Health check**: `curl https://your-domain.com/health`
2. **DB tables**: Verify ~15+ tables created in `whatsapp_api`
3. **Packages** (empty initially): `GET /api/v1/packages`
4. **SuperAdmin login**: `POST /api/v1/users/superadmin/login`
5. **Create package**: `POST /api/v1/packages` (with superadmin token)
6. **PM2 status**: `pm2 list` shows app online

## Open Questions

1. **Frontend serving**: Frontend has been built (`frontend/dist/`). Dockerfile only serves backend. Need nginx or similar to serve frontend, with `/api/*` proxied to backend.
2. **WebSocket**: Socket.IO on same port (4000). OK for single-node, needs sticky sessions for multi-instance.
3. **Rate limiting**: Redis-based in production. Need to confirm Redis is running on server.

## Current Code Status

- ✅ JWT secret validation exists in `src/middleware/jwt.ts:14-26` (rejects secrets < 32 chars or known weak values)
- ✅ Frontend build exists in `frontend/dist/`
- ⚠️ `app.ts:36` still calls `initializeSchema()` at startup (README says this shouldn't happen)
- ⚠️ `ecosystem.config.js` has hardcoded DB credentials (doesn't read `.env`)
- ❌ `connection.ts:6-9` throws if `DB_PASSWORD` is empty (good, but needs proper password set)
- ❌ Docker setup uses docker-compose services, but server runs Node.js directly with PM2

## Immediate Actions Required (User Asked)

1. **Fix `.env` DB credentials**: Update to match actual MySQL user/password
2. **Fix `ecosystem.config.js`**: Remove hardcoded credentials, use environment variables
3. **Verify Redis**: Ensure Redis is running for production rate limiting
4. **Fix Dockerfile**: Add nginx or static file serving for frontend/dist

## Recommended Production Architecture

```
Internet → Nginx (443 HTTPS) 
   → /api/* → Node.js PM2 (4000)
   → /socket.io → Node.js PM2 (4000 WebSocket)
   → / → Static files from frontend/dist/
```

## Updated Deployment Steps

```bash
# 1. Ensure MySQL & Redis are running (services or Docker)
sudo systemctl start mysql redis

# 2. Update .env with correct DB credentials
#    Set JWT_SECRET to 64-char hex string
#    Set SUPERADMIN_PASSWORD to 12+ chars

# 3. Run migrations (ONCE)
npm run migrate

# 4. Create SuperAdmin (ONCE)
npm run create-superadmin

# 5. Start backend with PM2
npm run build && pm2 start ecosystem.config.js --env production

# 6. Save & enable startup
pm2 save && pm2 startup

# 7. Serve frontend (nginx or static)
#    Copy frontend/dist to nginx html directory
```
