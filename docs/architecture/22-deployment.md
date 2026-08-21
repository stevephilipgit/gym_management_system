# 22 — Deployment

## What actually exists

- **No Dockerfile** (`docker-compose.yml` and `Dockerfile` do not exist in the
  repo). The `DEPLOYMENT_GUIDE.md` describes a Docker setup but it is not
  present.
- **No CI/CD configuration** (no `.github/workflows/`, `.gitlab-ci.yml`, etc.).
- **No PM2 config file** in the repo (the guide mentions `pm2 start` but no
  `ecosystem.config.js`).
- **No nginx/reverse proxy config.**
- **No monitoring/health dashboard** beyond the two `/api/health` endpoints.
- **No backup strategy** documented or configured.
- **No .env.production** or environment-specific config in the repo.

## Deployment options (from DEPLOYMENT_GUIDE.md — not verified against code)

The guide describes three options for starting the backend:
```
Option 1: cd backend && npm install --production && NODE_ENV=production npm start
Option 2: pm2 start server.js --name gym-api --env production
Option 3: FROM node:22-alpine (Dockerfile snippet)
```

None of these are automated or configured in the repo.

## Environment requirements

Required env vars: `JWT_ACCESS_SECRET`, `FIELD_ENCRYPTION_KEY`, `DATABASE_URL`.
Optional: `JWT_REFRESH_SECRET`, `REDIS_URL`, `GEMINI_API_KEY`, `SMTP_*`,
`GOOGLE_*`, `ALLOWED_ORIGINS`, `PORT`, `LOG_LEVEL`, `AI_ENABLED`.

`VALIDATE_ENV` runs at startup and throws if any required var is missing.

## Known deployment issues

1. `FIELD_ENCRYPTION_KEY` is required but never used (dead requirement).
2. `replace-domain.js` post-build script replaces `__SITE_URL__` in `dist/` files
   (sitemap.xml, robots.txt) but `index.html` uses `%VITE_SITE_URL%` which Vite
   substitutes at build time — works but the comment is misleading.
3. `ALLOWED_ORIGINS` must include the frontend domain in production or CORS
   will reject requests.
4. Production `secure` cookie flag depends on `NODE_ENV === 'production'`
   (`config.app.isProduction`). If NODE_ENV is not set, cookies are sent over
   HTTP (not secure).
5. no `__Host-` cookie prefix; no `Domain` attribute set (cookies are host-only).
6. Logs are written to local filesystem (`logs/`). In production, these need
   log rotation (configured in Winston, 5MB/5 files) and/or external aggregation.
7. Redis is required for CAPTCHA and rate limiting. If Redis is not available,
   login is blocked (CAPTCHA fails) and rate limiting is disabled.
8. The `uploads/` directory at the project root is used for static file serving
   (server.js:126). This directory must exist and be writable.

## Monitoring

- `GET /api/health` — returns `{status, timestamp, services: {database, redis, api}}`.
- `GET /api/health/info` — returns uptime, memory, DB state, Node version, env.
- Winston logs: `logs/error.log`, `logs/combined.log`, `logs/attendance.log`,
  `logs/exceptions.log`, `logs/rejections.log`.
- `AuditLog` MongoDB collection logs every state-changing request.
- No external monitoring integration (Datadog, Sentry, etc.) is configured.

## Scalability

- Single-process Express. No cluster mode configured. PM2 can be set up manually
  (documented in guide, not in repo).
- In-memory caches (settings, AI sessions) are per-process — a PM2 cluster would
  have inconsistent settings cache (5-min stale) and non-shared AI conversations.
- Google Sheets sync: single connector, no conflict resolution for concurrent
  attendance writes.
- Database: well-indexed for the main query paths. DailySummary avoids
  per-request aggregation.