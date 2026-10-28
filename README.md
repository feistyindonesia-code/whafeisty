# Whafeisty - WhatsApp API Unofficial

Layanan WhatsApp API unofficial berbayar dengan sistem paket. Provider menyediakan API, pengguna dapat menautkan maksimal device sesuai paket yang dipilih.

## Tech Stack

### Backend
- Node.js + Express + TypeScript
- Baileys v6 (WhatsApp Web API)
- MySQL (database)
- Redis (cache & queue)
- Socket.IO (WebSocket)
- JWT (authentication)
- bcryptjs (password hashing)

### Frontend
- React + TypeScript + Vite
- Tailwind CSS
- Socket.IO Client
- Axios
- React Router

## Quick Start

### Prerequisites
- Node.js 20+
- MySQL 8+
- Redis 7+
- Docker & Docker Compose (optional)

### 1. Clone & Install

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Set unique `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, and `SUPERADMIN_PASSWORD` values, plus a random `JWT_SECRET` of at least 32 characters. Set `FRONTEND_URL` to the frontend origin when it differs from `http://localhost:4173`.

### 3. Setup Database

```bash
# Option A: Using Docker Compose
docker-compose up -d mysql redis

# Option B: Manual MySQL setup
set -a; . ./.env; set +a
mysql -u root -p -e "CREATE DATABASE whatsapp_api;"
mysql -u root -p -e "CREATE USER 'whatsapp_user'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';"
mysql -u root -p -e "GRANT ALL PRIVILEGES ON whatsapp_api.* TO 'whatsapp_user'@'localhost';"
mysql -u root -p -e "FLUSH PRIVILEGES;"
```

### 4. Apply database migrations

```bash
npm run migrate
```

The migration command acquires a MySQL advisory lock, creates the legacy baseline schema if needed, records applied versions in `schema_migrations`, and applies pending migrations. Migration `0003` adds password reset storage and a token-version column used to revoke existing JWTs after a password reset. Migration `0004` limits each reset code to five verification attempts. Migration `0005` adds platform settings and SuperAdmin audit records. Migration `0006` adds package feature entitlements; new feature access is disabled unless explicitly enabled on a package. The API no longer creates or changes schema at startup; run migrations before starting it. Back up MySQL before production migrations. Migration `0002` revokes and removes legacy plaintext API keys; existing integrations must replace those keys. Keep applied migration versions/checksums immutable.

With Docker Compose, build the API image, start MySQL/Redis, run migration as a one-off container, then start the API:

```bash
docker compose build api
docker compose up -d mysql redis
docker compose run --rm api node dist-migrations/migrations/run.js
docker compose up -d api
```

### 5. Create SuperAdmin

```bash
npm run create-superadmin
```

Set `SUPERADMIN_EMAIL` and a unique `SUPERADMIN_PASSWORD` of at least 12 characters in `.env` before running the command. There are no default administrator credentials.

Customer registration requires at least 8 characters and at most 72 UTF-8 bytes. Login endpoints are limited to 10 attempts per IP in 15 minutes, and registration is limited to 5 attempts per IP per hour. In development (`NODE_ENV=development`), these limits use Express's in-memory store, so Redis is not required; counters are local to that backend process and reset when it restarts. All other environments use atomic Redis counters shared by API instances and fail closed with a server error if Redis is unavailable. Configure optional `REDIS_PASSWORD` or `REDIS_URL` when Redis authentication/URI configuration is used. For reverse-proxy deployments, set `TRUST_PROXY` to a comma-separated list of the exact trusted proxy IPs/subnets; it defaults to no proxy trust and rejects wildcard/boolean trust. Never trust forwarded client IP headers from untrusted peers.

Password recovery uses `POST /api/v1/users/password/forgot` and `POST /api/v1/users/password/reset`. The user requests a six-digit code by email, then enters the code, account email, and new password in the frontend. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, and `SMTP_FROM`; SMTP authentication is optional but `SMTP_USER` and `SMTP_PASSWORD` must be provided together. Production requires `SMTP_SECURE=true`. Codes expire after 30 minutes, are stored as HMAC hashes using `JWT_SECRET`, and allow at most five verification attempts. A maximum of three reset codes per account can be issued per hour, in addition to the IP rate limit. Codes work once, and requesting a new code invalidates the previous one. The request endpoint responds generically to avoid disclosing whether an email is registered. After a successful reset, all existing JWTs for that account are invalidated. For local testing, use a local SMTP catcher such as Mailpit and point the SMTP variables to it; do not send test messages to real customers.

Customer workspace: navigation is a desktop sidebar and mobile bottom navigation; available customer tools include device connection and messaging, contact consent/suppression, API key lifecycle, webhook management, subscription history, payment history, and usage summaries. Feature workspaces are linked at `/dashboard/features/api-docs`, `/dashboard/features/crm`, `/dashboard/features/broadcast`, `/dashboard/features/automessage`, `/dashboard/features/customer-service`, `/dashboard/features/advertising`, and `/dashboard/features/professional`; `/customer-service` is a standalone service workspace route in the same app. SuperAdmin assigns each feature independently in package create/edit. Docs API contains an initial endpoint/auth guide; CRM, message campaign execution, automation and advertising remain staged modules and are not advertised as fully operational. Broadcast implementation must retain consent, suppression, quota, and safety enforcement before any real sending is enabled. SuperAdmin workspace includes customer search and subscription suspension/reactivation, full payment history, package and approval workflows, platform safety/registration settings, and audit log.

### Database integration tests

`npm test` builds the backend and runs Node's built-in test runner. Unit tests do not need external services. MySQL integration tests are skipped unless `WHAFEISTY_TEST_DB_NAME` is explicitly set. Its valid identifier must end in `_test`; configure `DB_HOST`, `DB_PORT`, `DB_USER`, and `DB_PASSWORD` for that dedicated database. The integration tests explicitly select this database (not `DB_NAME`) and only create/delete uniquely identified fixtures; they never drop a database. Migration integration tests use a separate, empty-or-runner-managed disposable database configured by `WHAFEISTY_MIGRATION_TEST_DB_NAME`, also ending in `_test` and distinct from both `DB_NAME` and `WHAFEISTY_TEST_DB_NAME`. Example:

```bash
NODE_ENV=test WHAFEISTY_TEST_DB_NAME=whafeisty_concurrency_test \
WHAFEISTY_MIGRATION_TEST_DB_NAME=whafeisty_migrations_test \
npm test
```

Migration tests run the migration runner concurrently and alter migration metadata only in the explicitly named migration test database. On a fresh schema, they also create and clean up a temporary legacy API key fixture to verify plaintext-key revocation. Pre-create both test databases; tests do not create or drop databases. Never point either variable at development or production data. A real Redis integration test requires `WHAFEISTY_TEST_REDIS_URL` with a dedicated non-zero Redis database index, for example `redis://localhost:6379/15`; it uses one unique key and never flushes the database. Set `NODE_ENV=test` when running integration tests so they cannot inherit a production runtime setting.

Device quota is enforced inside a MySQL transaction by locking the account row, reading the active subscription package, counting persisted devices, and inserting the new device before releasing the lock. This serializes concurrent create attempts for that account across database connections and API instances. Disconnected devices remain counted until explicitly deleted; the current schema does not implement soft deletion.

Monthly message quota is enforced by locking the customer user row in MySQL while checking the active subscription, package limit, consent, sending pause, frequency caps, and reserving an outbound message-history row. That reservation commits before contacting WhatsApp, so a provider timeout or a failure to update final status cannot erase the consumed quota. A reservation starts in `error` (the existing schema has no queued/processing status); it is changed to `sent` after provider acceptance. A failed or ambiguous attempt stays `error` and still consumes quota and frequency allowance. This does not provide exactly-once delivery. Consent revocation takes the same user-row lock: if revocation commits before the send reservation, sending is blocked; once the reservation commits and the provider call begins, revocation cannot recall or reliably stop a message already in progress. Future asynchronous workers need a durable outbox with explicit reservation states and idempotency before being enabled.

### API key security and external integrations

Dashboard and customer workspace endpoints continue to use JWT. External integrations use a separate `X-API-Key` credential only on the explicit routes below:

- `GET /api/v1/devices/external` and `GET /api/v1/devices/external/:id` — `devices:read`
- `GET /api/v1/messages/external/:deviceId` — `messages:read`
- `POST /api/v1/messages/external` — `messages:send`; uses the same subscription, device ownership, consent, safety pause, frequency, and atomic message quota enforcement as the JWT send endpoint.

Manage keys using the dashboard JWT routes `GET|POST /api/v1/users/api-keys`, `PATCH|DELETE /api/v1/users/api-keys/:id`, and `POST /api/v1/users/api-keys/:id/rotate`. Creation and rotation return the full secret once; list/update never return a secret or hash. Supported scopes are `devices:read`, `messages:read`, and `messages:send`. Set `expires_at` to an ISO-8601 timestamp or `null`. Revocation immediately prevents subsequent authentication. Last-used timestamps are throttled per process and additionally guarded by a five-minute database condition.

Migration `0002` introduces key identifiers and SHA-256 secret hashes. Existing plaintext API keys cannot be converted safely because their secrets are already stored directly; the migration revokes all legacy keys, clears their plaintext values, and drops the legacy plaintext column. After applying it, create replacement keys and update each integration client. Do not deploy the new API code before running the migration. Key lifecycle actions are recorded in `api_key_audit_events`; audit records contain identifiers and action names only, never secrets.

Media uploads are validated using file signatures, stored under account-specific directories outside the public static root, and referenced by `media_id`. The message endpoint rejects legacy arbitrary `media_url` values to avoid allowing remote URL fetches. Existing media in the old public `uploads` directory is no longer served by the API; migrate required files to the private upload endpoint before relying on them.

### 6. Start Redis (if not using Docker)

```bash
# Linux
redis-server

# macOS
brew services start redis

# Or using Docker
docker run -p 6379:6379 redis:7-alpine
```

### 7. Start Backend

```bash
# Development (with auto-reload)
npm run dev

# Production
npm run build
npm start
```

### 8. Start Frontend

```bash
cd frontend
npm run dev
```

Frontend akan berjalan di `http://localhost:4173`, backend di `http://localhost:4000`.

## Application Flow

### 1. SuperAdmin
1. Login ke `/superadmin/login`
2. Dashboard menampilkan:
   - Semua paket + jumlah customer
   - Semua customer + status subscription
   - Pembayaran pending yang butuh verifikasi
3. Actions:
   - Buat/edit paket: nama, harga, device_limit, message_limit, deskripsi
   - Verifikasi pembayaran: approve / reject
   - Lihat detail customer: device usage, message usage, subscription status

### 2. Customer Registration
1. Buka halaman `/packages` untuk melihat daftar paket
2. Pilih paket dan klik "Select Package"
3. Isi form register: nama, email, password
4. Submit → akun dibuat dengan status `pending`
5. Upload bukti transfer → payment record dibuat
6. Menunggu verifikasi SuperAdmin

### 3. Customer Login & Dashboard
1. Login dengan email + password
2. Jika subscription `pending` → tampilkan "Menunggu verifikasi"
3. Jika subscription `active` → tampilkan dashboard:
   - API key
   - Device usage (X/Y)
   - Message usage (X/Y)
   - Device management (pairing, QR, disconnect)
   - Message history
   - Subscription info + expiry

### 4. Device Limit Enforcement
- Saat customer membuat device baru, backend cek:
  1. Subscription status harus `active`
  2. Device count < package.device_limit
  3. Jika exceeded → return error

### 5. Message Limit Enforcement
- Saat kirim pesan, backend hitung pesan bulan ini
- Jika message_count >= package.message_limit → return error

## API Documentation

### Base URL
```
http://localhost:4000/api/v1
```

### Authentication
Customer endpoints menggunakan JWT Bearer token:
```
Authorization: Bearer <token>
```

SuperAdmin endpoints menggunakan JWT Bearer token dengan role superadmin.

### Endpoints

#### Auth (JWT)
- `POST /users/register` - Register customer
- `POST /users/login` - Login customer
- `POST /users/superadmin/login` - Login superadmin
- `POST /users/password/forgot` - Request a password reset email
- `POST /users/password/reset` - Set a new password using a reset token
- `GET /users/me` - Get current user

#### Packages
- `GET /packages` - List active packages
- `POST /packages` - Create package (superadmin)
- `PUT /packages/:id` - Update package (superadmin)
- `DELETE /packages/:id` - Delete package (superadmin)

#### Subscriptions
- `GET /subscriptions/me` - Get my subscription
- `GET /subscriptions/pending` - List pending subscriptions (superadmin)
- `POST /subscriptions/:id/approve` - Approve subscription (superadmin)
- `POST /subscriptions/:id/reject` - Reject subscription (superadmin)

#### Payments
- `POST /payments/upload` - Upload payment proof
- `GET /payments/me` - Get my payment history
- `GET /payments/pending` - List pending payments (superadmin)
- `POST /payments/:id/approve` - Approve payment (superadmin)
- `POST /payments/:id/reject` - Reject payment (superadmin)

#### Devices
- `POST /devices` - Create new device
- `GET /devices` - List devices
- `GET /devices/:id` - Get device details
- `GET /devices/:id/qrcode` - Get QR code for pairing
- `POST /devices/:id/connect` - Reconnect device
- `POST /devices/:id/disconnect` - Disconnect device
- `DELETE /devices/:id` - Delete device
- `GET /devices/:id/status` - Get device status

#### Messages
- `POST /messages` - Send text or uploaded media (`media_id`; arbitrary remote media URLs are not accepted)
- `GET /messages/:deviceId` - Get messages
- `GET /messages/:deviceId/:messageId` - Get specific message
- `GET /messages/safety` - Read sending pause state and per-contact limits
- `POST /messages/safety/resume` - Resume paused sending after explicit confirmation

#### Contacts
- `GET /contacts/:deviceId` - Get contacts
- `GET /contacts/:deviceId/:phone` - Get contact by phone
- `GET /contacts/consents` - List consent and opt-out records
- `POST /contacts/consents` - Record consent with purpose, source, and evidence reference
- `POST /contacts/consents/revoke` - Manually revoke consent and suppress a contact
- `GET /contacts/consents/:phone/events` - View consent audit history

#### Webhooks
- `POST /webhooks` - Register webhook
- `GET /webhooks` - List webhooks
- `PUT /webhooks/:id` - Update webhook
- `DELETE /webhooks/:id` - Delete webhook

#### Groups
- `GET /groups/:deviceId` - List groups
- `POST /groups/:deviceId` - Create group

#### Media
- `POST /media` - Upload supported media (JPEG, PNG, GIF, MP4, MP3, PDF; max 16 MiB)
- `GET /media/download/:mediaId` - Download owned media with customer authentication

#### Usage
- `GET /usage/devices` - Get device usage
- `GET /usage/messages` - Get message usage

### Messaging safety behavior

- Outbound messages are blocked unless the workspace has an active consent record for the normalized recipient number.
- Consent records require a purpose, source, and evidence reference. These form an audit trail and operator attestation; the application cannot independently prove recipient consent, so only record genuine permission.
- Supported inbound opt-out replies (`STOP`, `UNSUBSCRIBE`, `CANCEL`, `QUIT`, `END`, `REMOVE`, `OPT OUT`, `BERHENTI`, and `JANGAN KIRIM`) suppress further messages to that contact and are added to the consent event history.
- Defaults are 10 outbound messages per contact per rolling 24 hours and 30 per rolling 7 days. Configure with `CONTACT_DAILY_MESSAGE_LIMIT` and `CONTACT_WEEKLY_MESSAGE_LIMIT`.
- Five consecutive provider-send failures pause outbound sending for the workspace for 60 minutes by default. Configure with `SEND_FAILURE_PAUSE_THRESHOLD` and `SEND_FAILURE_PAUSE_MINUTES`; resuming early requires explicit dashboard confirmation.
- These controls reduce unsolicited and excessive sending; they cannot guarantee an account will not be restricted. This project uses an unofficial WhatsApp client. Use WhatsApp Business Platform and its current policies for business-critical messaging.

## Database Schema

### users
- id, email, password_hash, role (customer/superadmin), name, created_at, updated_at

### packages
- id, name, price, device_limit, message_limit, description, active, created_at, updated_at

### subscriptions
- id, user_id, package_id, status (active/pending/expired/suspended), start_date, end_date, created_at, updated_at

### payments
- id, user_id, package_id, amount, method, status (pending/paid/rejected/expired), proof_url, paid_at, verified_by, verified_at, created_at

### accounts
- id, user_id, package_id, name, max_devices, created_at, updated_at

### devices
- id, account_id, device_id, status, connection_status, last_seen, created_at

### api_keys
- id, account_id, key, name, permissions, expires_at, created_at, last_used

### messages
- id, from_number, to_number, content, media_url, status, message_id, direction, device_id, created_at

### contacts
- id, device_id, phone_number, name, profile_picture_url, created_at

### contact_consents / contact_consent_events
- Current per-workspace consent status, purpose, evidence reference, and append-only consent/opt-out events

### send_safety_states
- Per-workspace consecutive provider failures and automatic sending pause state

### webhooks
- id, account_id, url, events, secret, active, created_at, updated_at

## Security

- JWT authentication for customer/superadmin
- Device ownership checks for protected device operations and WebSocket subscriptions
- Payment proofs stored outside the public upload directory and served only to SuperAdmins
- Password hashing with bcrypt
- Role-based access control
- Required JWT and database secrets (no application defaults)

Place the service behind HTTPS and configure rate limiting at the reverse proxy before production use.

## License

MIT
