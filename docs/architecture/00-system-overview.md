# 00 — System Overview

## What the application actually is

Giri Gym is a **customer-specific, single-tenant gym management application** for
one gym (Mathur, Chennai, India). It is a modular monolith:

- **Frontend:** React 19 SPA served separately (Vite build), also hosting the
  public marketing homepage and a public kiosk attendance page.
- **Backend:** Express 4 REST API with MongoDB (Mongoose ODM) persistence,
  Redis for rate limiting and CAPTCHA only, JWT cookie-based auth, and a small
  Google Gemini integration.

It manages members (register / renew / dues / expiry), attendance (punch in/out,
kiosk), packages, diet plans, daily finance summaries, reports, enquiries, admin
users, system settings, and a superadmin-only AI assistant.

The system was recently extended with **gender-scoped access control** (branch
`feature/gender-scope-access-control`): admins have a `scope` of `all` /
`male` / `female_plus_transgender`, and member/enquiry/attendance/report data is
filtered by that scope.

## Top-level data flow (verified)

```
Browser (React SPA, Vite)
  → apiClient (axios, withCredentials, 401→/admin/refresh single-flight)
  → Express (server.js)
  → security middleware: helmet + CSP, CORS (ALLOWED_ORIGINS), compression,
    express.json, cookie-parser, noSqlSanitizer (express-mongo-sanitize), hpp,
    auditLogger (AuditLog collection), global rate limit (120/min)
  → Route module (each mounts adminAuth and often requireRole + Joi validation)
  → Controller
  → Service / Repository (Mongoose)
  → MongoDB (members, admins, attendance, payments, financelogs,
    dailysummaries, diets, packages, dynamicfields, enquiries,
    google sheets connectors, systemsettings, counters, auditlogs)
  → JSON response
  → React renders (Tailwind + custom CSS)
```

Redis is involved only in: rate limiting (`rate-limiter-flexible`,
`middleware/rateLimiter.js`), CAPTCHA storage (`services/captchaService.js`),
and the health check (`controllers/healthController.js`). **Redis is not used for
sessions, caching of business data, or queues.** This contradicts the
`DEPLOYMENT_GUIDE.md`, which claims "Redis for session management" and "Daily
summary caching (redis)" — neither exists in code.

## Feature classification legend

| Class | Meaning |
|-------|---------|
| IMPLEMENTED | Works end-to-end and matches the UI |
| PARTIALLY IMPLEMENTED | Works but with known gaps, dead branches, or missing authorization |
| BROKEN | Code exists but does not function as intended |
| DEAD / UNUSED | No live callers / no route / unreachable |
| DUPLICATED | Same logic exists in more than one place |
| SECURITY RISK | An authorization or data-exposure weakness |
| PERFORMANCE RISK | A likely cause of slowness |
| UNKNOWN | Cannot be proven from code — requires clarification |

## Master status summary

| Module | Status | Key evidence |
|--------|--------|--------------|
| Authentication (login, JWT, CAPTCHA, refresh) | IMPLEMENTED (hardened: per-device sessions, tokenVersion, admin status) | `controllers/authController.js`, `middleware/adminAuth.js`, `models/AdminSession.js` |
| RBAC (superadmin gating) | IMPLEMENTED (diet DELETE now superadmin-gated; dashboard/analytics superadmin-only) | `middleware/requireRole.js`, `dietRoutes.js`, `financeRoutes.js` |
| Gender scope (members/enquiries/reports/attendance) | IMPLEMENTED (centralized `scopeResolver`; all access paths scoped) | `core/scopeResolver.js`, `attendanceController.js`, `enquiryController.js`, `reportsController.js` |
| Member management | IMPLEMENTED (registration gender UI added) | `controllers/memberController.js`, `AdminRegister.jsx` |
| Gym ID / member code system | PARTIALLY IMPLEMENTED | numeric `gymId` global vs `memberCode` M1001/F1001/T1001 per-gender |
| Attendance | IMPLEMENTED (search-punch/punch-manual/stats today now gender-scoped) | `controllers/attendanceController.js` |
| Finance dashboard / summaries | IMPLEMENTED (superadmin-only) | `controllers/paymentController.js`, `financeRoutes.js` |
| Packages | IMPLEMENTED (gender-scoped; superadmin filter) | `controllers/packageController.js`, `models/Package.js` |
| Diet manager | IMPLEMENTED (gender-scoped; gender locked for trainers; DELETE superadmin-only) | `controllers/dietController.js`, `models/Diet.js` |
| Admin management | IMPLEMENTED (superadmin creates male/female trainer accounts) | `frontend/src/admin/AdminManageAdmins.jsx`, `routes/adminRoutes.js` |
| Reports | IMPLEMENTED (CSV exports now gender-scoped) | `controllers/reportsController.js` |
| Enquiries | IMPLEMENTED (`?gender=` override removed; public form collects gender) | `controllers/enquiryController.js`, `EnquiryModal.jsx` |
| Settings | IMPLEMENTED | `services/systemSettingsService.js` (in-memory cache) |
| AI assistant | IMPLEMENTED (superadmin only) | `services/ai/*`, `routes/aiRoutes.js` |
| Google Sheets sync | PARTIALLY IMPLEMENTED / BROKEN OAuth | `services/googleSheetsService.js` (service-account path only) |
| Invoices | DEAD backend / PARTIAL frontend jsPDF | `admin/utils/invoicePdf.js` |
| Uploads | IMPLEMENTED (2 MB limit + consistent path) | `routes/memberRoutes.js`, `routes/uploadRoutes.js` |
| Audit logging | IMPLEMENTED (semantic events now persist to `auditlogs`) | `server.js`, `middleware/requestLogger.js` |
| Health check | IMPLEMENTED | `controllers/healthController.js` |

See [27-production-hardening.md](27-production-hardening.md) for the full
implementation record.

## The three biggest issues at a glance

1. **Gender scope is not enforced on every attendance/report path.**
   `POST /attendance/search-punch`, `POST /attendance/punch-manual`,
   `GET /attendance/stats/today`, and `GET /reports/export/attendance` return
   all genders to any authenticated admin. (Part 5 of the gender-scope plan.)
2. **Enquiry scope can be bypassed with a query parameter.** A trainer can pass
   `?gender=Female` to `GET /api/enquiries` and `GET /api/enquiries/export/csv`
   and override the scope filter (`enquiryController.js:206`, `:376`).
3. **Documentation does not match code.** `README.md` and `DEPLOYMENT_GUIDE.md`
   claim CSRF (csurf), invoice endpoints, Redis session management, 46 validated
   endpoints, and a layered repository architecture that only partially exists.

See [19-security.md](19-security.md), [25-stability-plan.md](25-stability-plan.md),
and [26-migration-assessment.md](26-migration-assessment.md) for detail.
