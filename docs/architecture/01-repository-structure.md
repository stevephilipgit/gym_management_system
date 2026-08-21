# 01 — Repository Structure

## Root layout

```
E:\projects\gym_project-E2E\
├── backend/                 Express + MongoDB API (ESM)
├── frontend/                React 19 + Vite SPA
├── logs/                    Winston log output (combined/error/exceptions/attendance)
├── uploads/                 Multer disk storage for member photos
├── .env                     Backend secrets (git-ignored)
├── .env.example             Template for backend env
├── .gitignore
├── DEPLOYMENT_GUIDE.md      Stale deployment doc (contradicts code — see 22-deployment.md)
├── PERFORMANCE_OPTIMIZATION_GUIDE.txt  Stale marketing-style performance doc
├── README.md                Stale feature README (contradicts code — see below)
├── query                    Empty placeholder file ("MongoDB")
└── LICENSE
```

There is **no** `apps/`, `packages/`, `docker-compose.yml`, `Dockerfile`, CI
config (`.github/`, `.gitlab-ci.yml`), or monorepo tooling. The repo is two
independent apps plus scripts.

## Backend (`backend/`)

Entry points:
- `src/server.js` — actual app entry (express app + middleware + routes + cron).
- `src/app.js` — one-liner that imports `server.js` (kept for legacy `npm start` path compatibility).
- `src/seed.js` — admin/package/dynamic-field seeding (`npm run seed`).
- `scripts/*.js` — maintenance scripts (see below).

```
backend/
├── src/
│   ├── config/
│   │   ├── index.js          Central env config (JWT, DB, Redis, email, google, ai)
│   │   ├── db.js             Mongoose connection
│   │   ├── redis.js          Redis client (connect-on-import, 5 reconnect cap)
│   │   └── validateEnv.js    Startup required-env check (JWT_ACCESS_SECRET, FIELD_ENCRYPTION_KEY, DATABASE_URL)
│   ├── core/
│   │   ├── logger.js         Winston: console + logs/error.log + logs/combined.log (+ exception/rejection handlers)
│   │   ├── attendanceLogger.js  Dedicated logs/attendance.log writer
│   │   ├── errorHandler.js   AppError hierarchy + global error middleware + asyncHandler
│   │   ├── constants.js      ACTION_TYPES, roles, status enums
│   │   └── scopeResolver.js  Gender-scope rules (all/male/female_plus_transgender)
│   ├── middleware/
│   │   ├── adminAuth.js      JWT verify → req.admin {id, username, role, scope}
│   │   ├── requireRole.js    Role gate
│   │   ├── schemaValidator.js Joi validateSchema/validateQuery/validateParams
│   │   ├── attendanceValidation.js  input type detection + punch/manual validators
│   │   ├── rateLimiter.js    Redis-backed limiters (default/otp/admin/sensitive/captcha)
│   │   ├── aiRateLimiter.js  express-rate-limit variants for AI
│   │   ├── sanitizer.js      express-mongo-sanitize + hpp
│   │   ├── securityHeaders.js helmet + CSP + extra headers
│   │   └── requestLogger.js  AuditLog collection writer (auditLogger)
│   ├── controllers/          17 controllers (see feature docs)
│   ├── routes/               15 route modules (see 03)
│   ├── services/             attendance, summary, settings, captcha, email,
│   │                         googleSheets, diet, analytics, atomicCounter,
│   │                         attendanceSync + ai/ (9 files)
│   ├── repositories/         memberRepository, packageRepository, paymentRepository
│   ├── models/               13 Mongoose models
│   ├── schemas/              Joi schemas: auth, member, package, diet, field
│   ├── jobs/                 attendanceJobs.js (cron + startup), reminderAgent.js (disabled)
│   ├── utils/                auditLog.js, dbIndexes.js (stale), nameFormatter.js, pdfGenerator.js
│   ├── tests/                attendance.test.js, security.test.js
│   └── uploads/              local disk store for multer (server relative)
└── scripts/
    ├── seed.js               DB seeding (wraps src/seed.js)
    ├── createAdmin.js        Creates a hardcoded superadmin (steveadmin2026)
    ├── createIndexes.js      Finance/Member indexes
    ├── applyIndexes.js       Applies utils/dbIndexes.js definitions (includes stale signedpdflinks)
    ├── setupAttendance.js    Attendance indexes + setup notes
    └── checkOptimization.js  (not verified in detail — legacy utility)
```

## Frontend (`frontend/`)

Entry points:
- `index.html` — meta/SEO heavy; `%VITE_SITE_URL%` placeholders replaced by Vite; `src/main.jsx`.
- `vite.config.js` — React plugin with babel `babel-plugin-react-compiler`; dev proxy `/api → http://localhost:5000`.
- `tailwind.config.cjs`, `postcss.config.cjs`.
- `eslint.config.js` — flat config.
- `scripts/replace-domain.js` — post-build placeholder swap (`__SITE_URL__` → VITE_SITE_URL).

```
frontend/
├── src/
│   ├── main.jsx             Theme init + env check + render
│   ├── App.jsx              Router; lazy routes; AuthGuard + RoleGuard wiring
│   ├── index.css            ~4300 lines: Tailwind + custom themes + component CSS
│   ├── theme.js             Dark/light theme persistence
│   ├── pages/               Home, Login, KioskAttendance
│   ├── admin/               Admin shell + feature pages
│   │   ├── AdminLayout, AdminSidebar, AdminHeader
│   │   ├── Authguard.jsx (component) + authContext.js + RoleGuard.jsx
│   │   ├── AdminDashboardHome, AdminMembers, AdminRegister, AdminUpdate,
│   │   │   AdminDues, AdminManagePackages, AdminManageFields,
│   │   │   AdminDietManager, AdminEnquiries, AttendanceFrontDesk,
│   │   │   InactiveReportsPage, SettingsPage
│   │   ├── components/      DietSelector, RegisterForm, GoogleSheetsConnector,
│   │   │                    ui/{IconButton,ToggleSwitch}
│   │   ├── features/ai-assistant/ AiAssistant, ChatWindow, MessageBubble, ReminderTable
│   │   ├── styles/AiAssistant.css
│   │   └── utils/           attendanceHelpers.js, invoicePdf.js
│   ├── components/
│   │   ├── shared/          ErrorBoundary, PunchModal, MembershipCheckSection (DEAD),
│   │   │                    MemberValidityCheck (DEAD)
│   │   └── features/enquiry/ EnquiryModal
│   ├── hooks/useFormValidation.js  (DEAD)
│   └── utils/               apiClient, envCheck, googleSheetsClient, memberStatus,
│                            sanitizeHtml (DEAD), soundManager (DEAD),
│                            validation (DEAD)
```

## Dead / unused inventory (verified by import analysis)

Frontend (no importer):
- `components/shared/MembershipCheckSection.jsx`
- `components/shared/MemberValidityCheck.jsx`
- `hooks/useFormValidation.js`
- `utils/sanitizeHtml.js`, `utils/soundManager.js`, `utils/validation.js`
- `theme.js` `toggleTheme` export (defined, never imported)
- `googleSheetsClient.js` `connectGoogleSheets` (never imported)
- `admin/AdminUpdate.jsx` — routed but has no sidebar link (orphan; edit is duplicated in AdminMembers)

Backend:
- `services/attendanceService.js` `getLastAttendance` (no callers)
- `services/dietService.js` (controller uses `Diet` model directly; service unused)
- `controllers/uploadController.js` `uploadBulkData`, `getFileInfo` (no routes)
- `controllers/analyticsController.js` several handlers (getMemberStatistics,
  getRevenueStatistics, getMembershipTrends, getActiveMembersCount,
  getExpiringMembers, getRevenueByPackage, getRevenueByTrainingType,
  getPaymentModeDistribution, getDashboardSummary) — **no routes**
  (`analyticsRoutes.js` only mounts `/metrics` and `/export-pdf`).
  `getDashboardSummary` calls `analyticsService.getDashboardSummary` which does
  not exist in `analyticsService.js` — would throw if ever routed.
- `utils/dbIndexes.js` `signedpdflinks` collection + TTL — the model/flow was
  removed (commit `8cc83d1` "remove dead invoice sharing flow"); definition is stale.
- `jobs/reminderAgent.js` — `enabled: false` by design.
- `googleSheetsService.js` `getAuthorizationUrl` / `getTokensFromCode` return
  empty/stub values (deprecated OAuth flow).

## Discrepancies: README / DEPLOYMENT_GUIDE vs. code

| Claim in docs | Reality |
|---------------|---------|
| "CSRF protection (csurf)" (README, DEPLOYMENT_GUIDE) | No csurf dependency. CSRF is only mitigated by `sameSite=strict` cookies + CORS. |
| Invoice endpoints `POST /api/invoices/...generate-share-link`, `GET /api/invoices/:id/download` (DEPLOYMENT_GUIDE) | Do not exist. Invoice sharing flow was removed (`8cc83d1`). |
| "InvoiceController" | Does not exist (`controllers/` has no invoiceController). |
| "Redis for session management", "Daily summary caching (redis)" | Redis used only for rate limits + CAPTCHA. |
| "46 validated endpoints" / "authController (870 lines)" / "memberController (950+ lines)" | Actual: ~14 schemas wired; authController 494 lines; memberController 567 lines. |
| `core/config.js` | Actual path is `src/config/index.js`. |
| README endpoints `POST /api/auth/login`, `/api/attendance/punch-in`, `POST /api/invoices` | Do not exist. Real: `/api/admin/login`, `/api/attendance/search-punch`, no invoice endpoints. |
| "Charts: Chart.js" | Actual: recharts. |
| "Testing: Jest, Mocha (setup ready)" | Mocha+Chai only; no Jest. |
