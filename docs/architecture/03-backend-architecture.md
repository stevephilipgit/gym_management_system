# 03 — Backend Architecture

## Stack (verified from `backend/package.json`)

| Concern | Choice | Version | Why (evidence) |
|---------|--------|---------|----------------|
| Runtime | Node.js (ESM) | `"type": "module"` | `package.json:4` |
| Framework | Express | 4.18 | `server.js` |
| Database | MongoDB | driver 7.5, Mongoose 8.20 | `config/db.js` |
| Auth | JWT (jsonwebtoken) | 9.0 | `controllers/authController.js` |
| Password | bcryptjs | 3.0 | `controllers/authController.js` |
| Validation | Joi | 17.11 | `schemas/*.js` |
| CAPTCHA | Custom (SVG + Redis + SHA-256) | — | `services/captchaService.js` |
| Rate limiting | express-rate-limit + rate-limiter-flexible | 8.2 / 10.0 | `middleware/rateLimiter.js` |
| Logging | Winston | 3.19 | `core/logger.js` |
| Cron | node-cron | 3.0 | `server.js` attendance + enquiry cleanup |
| Email | nodemailer | 8.0 | `services/emailService.js` |
| File upload | multer | 2.0 | `routes/uploadRoutes.js`, `memberRoutes.js` |
| PDF | pdfkit | 0.13 | `utils/pdfGenerator.js` |
| AI | @google/generative-ai | 0.24 | `services/ai/aiClient.js` |
| Google Sheets | googleapis | 150 | `services/googleSheetsService.js` |
| Security | helmet, express-mongo-sanitize, hpp, compression | — | `middleware/securityHeaders.js`, `sanitizer.js` |

No TypeScript, no NestJS, no PostgreSQL, no Docker, no CI. There is **no csurf**,
despite the README and DEPLOYMENT_GUIDE claiming CSRF protection.

## Startup sequence (server.js:218-273)

```
startServer():
  1. connectDB()           — Mongoose.connect(config.db.url)
  2. initDailyTasks()      — 60s interval: mark previous day summary completed
  3. startupRecoveryJob()  — auto-close yesterday's open attendance records
  4. cron.schedule("59 23 * * *", autoCloseJob)  — close today's open records
  5. cron.schedule("*/30 * * * *", staleAutoCloseJob)  — close 2h+ stale records
  6. cron.schedule("0 2 * * *", cleanupOldEnquiries)  — delete old spam/closed
  7. app.listen(config.app.port)
```

## Middleware pipeline (server.js:74-188, order matters)

```
1. request ID (uuid) + child logger           ← req.logger
2. compression
3. helmet (CSP, HSTS, etc.)
4. additionalHeaders (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy)
5. CORS (ALLOWED_ORIGINS)
6. express.json (10mb limit)
7. express.urlencoded (10mb limit)
8. cookieParser
9. noSqlSanitizer (express-mongo-sanitize, replaceWith "_", logs sanitized keys)
10. hppProtection
11. auditLogger (AuditLog collection on finish — only auth/admin paths + POST/PUT/PATCH/DELETE)
12. global rate limit (120/min on /api/ by default)
13. route mounting
14. /api catch-all (404)
15. errorHandler (AppError hierarchy + Mongoose/JWT error normalization)
```

## Route mounting (server.js:143-164)

```
/api/admin          → adminRoutes       (login, me, create, update, delete, list, refresh, logout, forgot/reset)
/api/fields         → fieldRoutes       (GET /member, POST /member, PATCH toggle, DELETE)
/api/members        → memberRoutes      (register, list, get, update, delete, renew, due, public-validity)
/api/packages       → packageRoutes     (GET all, POST, PUT, DELETE — writes superadmin-only)
/api/upload         → uploadRoutes      (POST / photo)
/api/analytics      → analyticsRoutes   (GET /metrics, GET /export-pdf, POST /export-pdf)
/api/diets          → dietRoutes        (GET all/one, POST, PUT, DELETE — no requireRole)
/api/public         → publicRoutes      (GET /check-member, GET /packages)
/api/finance        → financeRoutes     (GET /summary/today, /today, /income, /analytics/*)
/api/ai             → adminAuth + requireRole("superadmin") + aiRoutes (POST /chat, POST /confirm)
/api/attendance     → attendanceRoutes  (adminAuth only; no requireRole)
/api/reports        → reportsRoutes     (adminAuth only)
/api/settings       → systemSettingsRoutes (requireRole("superadmin"))
/api/connectors     → connectorsRoutes  (requireRole("superadmin"))
/api/enquiries      → enquiryRoutes     (POST public, GET/PATCH/DELETE adminAuth)
GET /               → health message
GET /api/health     → health check
GET /api/health/info → health info
```

## Controller → Service → Repository pattern

The layered architecture is **inconsistently applied**:

- **Members**: controller → repository (data access) + inlined business logic
  (days-left calculation, ID generation, audit logging).
- **Attendance**: controller → service (business logic). No repository — direct
  `Attendance.find/findOne` in both controller and service.
- **Payments**: controller → repository (data access) + direct model access in
  controller for aggregations (DailySummary, FinanceLog, Member).
- **Packages**: controller → repository. Clean.
- **Diets**: controller → direct model (`Diet`). `dietService.js` exists but is
  **unused** — the controller never imports it.
- **Enquiries**: controller → direct model. No service layer.
- **Settings**: controller → service (with in-memory cache). No repository.
- **AI**: file-per-concern architecture (chatService, agentRunner, toolExecutor,
  aiClient, conversationStore, etc.). Clean separation.

## Key config/env (`config/index.js`)

```javascript
// Required env vars (validateEnv.js throws if missing):
JWT_ACCESS_SECRET, FIELD_ENCRYPTION_KEY, DATABASE_URL

// Optional with defaults:
PORT=5000, NODE_ENV=development, REDIS_URL=redis://localhost:6379
JWT_ACCESS_EXPIRES=15m, JWT_REFRESH_EXPIRES=7d
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
AI_ENABLED=false, GEMINI_MODEL=gemini-1.5-flash
```

- `FIELD_ENCRYPTION_KEY` is required but never used in the codebase (no field
  encryption is implemented). **Dead configuration requirement.**
- `JWT_REFRESH_SECRET` defaults to `JWT_ACCESS_SECRET` if not set (config.js:14).