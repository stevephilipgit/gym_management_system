# 19 — Security Audit

Severity: **CRITICAL** / **HIGH** / **MEDIUM** / **LOW**. Every finding cites evidence.

## CRITICAL

### C1 — Attendance `search-punch` has no gender-scope enforcement (IDOR)
- **Evidence:** `attendanceController.js:102-311`. `searchPunch` resolves a member
  by `gymId`/phone and proceeds with punch + returns member PII (name, phone,
  photo, plan) with **no** `scopeResolver.checkMemberScope` call. Route is
  `adminAuth` only (`attendanceRoutes.js:13-17`).
- **Impact:** A male-scope trainer can search/punch female and transgender
  members and read their PII. Direct API call bypass of gender isolation.
- **Fix:** After member lookup, verify scope; return a consistent 403/404
  without member data. (Part 5 item.)

### C2 — Attendance `punch-manual` accepts any memberId (IDOR)
- **Evidence:** `attendanceController.js:409-493` — `mark_entry`/`mark_exit`
  operate on the body `memberId` with no scope check. Route `adminAuth` only.
- **Impact:** Trainer can create attendance for any member regardless of gender.
- **Fix:** Load member + scope check before both actions. (Part 5 item.)

## HIGH

### H1 — Enquiry gender-scope override via `?gender=` query param
- **Evidence:** `enquiryController.js:205-211` (`if (gender) { filter.gender =
  gender }`) and the same at `:375-380` in `exportEnquiriesCSV`.
- **Impact:** Any authenticated admin can read/export enquiries of any gender by
  adding a `gender` query parameter, bypassing `req.admin.scope`.
- **Fix:** Remove the query-param override; always apply the scope-derived filter
  (intersect, never replace).

### H2 — Reports attendance & inactive CSV exports ignore gender scope
- **Evidence:** `reportsController.js:100-142` (`exportAttendanceCSV` —
  `Attendance.find(filter)` with no member-gender constraint) and `:208-267`
  (`exportInactiveReport` — no gender filter). Routes `adminAuth` only.
- **Impact:** Any admin can download all genders' attendance/member data.
- **Fix:** Add a member-gender `$in` filter via Member lookup (or store gender on
  Attendance).

### H3 — Attendance `stats/today` returns all-gender counts
- **Evidence:** `attendanceController.js:542-556` → `attendanceService.getTodayStats`
  (`attendanceService.js:192-221`) counts every Attendance for today.
- **Impact:** Gender totals leaked to any admin.
- **Fix:** Scope the counts by allowed genders.

## MEDIUM

### M1 — Diet DELETE not role-gated
- **Evidence:** `dietRoutes.js:30` — `router.delete("/:id", adminLimiter,
  adminAuth, dietController.deleteDiet)` with no `requireRole`.
- **Impact:** Trainer/finance can delete diet plans (data loss).
- **Fix:** Add `requireRole("superadmin")`.

### M2 — Member list `?search=` bypasses gender filter
- **Evidence:** `memberController.js:181` — `getAllMembers` calls
  `memberRepository.search(search)` without the gender filter when `search` is
  present.
- **Impact:** Any admin can list members of all genders via search.
- **Fix:** Pass the gender filter to the search path.

### M3 — No CSRF token (relying on SameSite + CORS)
- **Evidence:** No `csurf`/`csrf` dependency in `backend/package.json`. Cookies
  are `sameSite: strict` (`authController.js:62,70`); CORS restricted to
  ALLOWED_ORIGINS (`server.js:99-110`). README/DEPLOYMENT_GUIDE claim csurf —
  false.
- **Impact:** Same-site requests carry cookies; a cross-site form POST to an
  allowed-origin endpoint could trigger state changes. SameSite=strict blocks
  cookie on cross-site POSTs in modern browsers, mitigating most CSRF.
- **Fix (optional):** Add CSRF tokens or double-submit cookie for state-changing
  endpoints.

### M4 — JWT scope/role are trusted from token only
- **Evidence:** `adminAuth.js:13` sets `req.admin` from decoded claims; no DB
  reload. Scope changes take effect only at next login/refresh.
- **Impact:** If the access secret leaks, an attacker can mint tokens with
  `role: superadmin`, `scope: all`. Standard JWT tradeoff; ensure secret
  strength.

### M5 — Refresh secret falls back to access secret
- **Evidence:** `config/index.js:14` — `refreshSecret: process.env.JWT_REFRESH_SECRET
  || process.env.JWT_ACCESS_SECRET`.
- **Impact:** If only one secret is configured, compromise of one compromises
  both. Recommend a distinct refresh secret.

### M6 — Member photo upload lacks the 2 MB limit
- **Evidence:** `memberRoutes.js:29-43` multer has no `limits` (unlike
  `uploadRoutes.js:46-50` which sets 2 MB).
- **Impact:** Large uploads accepted on register/update.
- **Fix:** Add `limits: { fileSize: 2*1024*1024 }` to the member multer.

### M7 — Public kiosk page + authenticated punch
- **Evidence:** `/kiosk-attendance` is public (`App.jsx:47`) and calls an
  adminAuth-protected endpoint. No PIN gate (commit `6a6fc1b` removed it).
- **Impact:** Anyone on a shared kiosk browser with a logged-in trainer session
  can punch members; combined with C1, any gender.
- **Fix:** Scope enforcement in searchPunch (C1); optionally restore a kiosk
  PIN/cooldown.

### M8 — Failed logins not logged to AuditLog with admin context
- **Evidence:** `authController.js:128` — `auditActions.adminLogin(req, admin._id,
  true)` only on success. The `auditLogger` middleware does record
  `POST /api/admin/login -> 401` (path-based), so failures appear as HTTP
  requests, not as auth events.
- **Impact:** Poor forensic fidelity for brute-force attempts.
- **Fix:** Log failed login attempts with username/IP.

## LOW

### L1 — `getInactiveMembers` total count omits gender filter
- Evidence: `reportsController.js:56-62`.

### L2 — CAPTCHA is simple SVG
- Evidence: `captchaService.js:56-88` — single font, low noise. Weak against
  determined OCR; acceptable for basic bots.

### L3 — `uploadBulkData`/`getFileInfo` and other dead controllers exist
- Evidence: `uploadController.js:25-67` (no routes). Dead code, no risk beyond
  confusion.

### L4 — Admin can delete their own account
- Evidence: `adminRoutes.js:49` DELETE /:id superadmin-only; no self-delete guard.

### L5 — Public `/public/check-member` + `/members/public-validity` reveal member existence
- Evidence: `memberController.js:377-430` returns found:true with name/phone/plan.
  Pre-existing design (public validity check); moderate privacy exposure of
  member name/phone by gymId or phone. Not part of the attendance scope.

### L6 — AI has no audit trail and no gender scope
- Evidence: `services/ai/*`; `getTotalMembers`/`getExpiringMembers` query all
  members. Superadmin-only gate limits exposure, but actions are unlogged.

### L7 — `FIELD_ENCRYPTION_KEY` required but unused
- Evidence: `validateEnv.js:5` requires it; no code reads it (grep confirms).
  Dead requirement that blocks startup if missing.

### L8 — `replace-domain.js` looks for `__SITE_URL__` but index.html uses `%VITE_SITE_URL%`
- Evidence: `frontend/scripts/replace-domain.js` replaces `__SITE_URL__`;
  `frontend/index.html` uses `%VITE_SITE_URL%` (Vite substitutes the `%...%`
  form at build time). Comment vs. code mismatch; harmless but confusing.

## NoSQL injection / XSS

- **NoSQL injection:** mitigated by `express-mongo-sanitize` (server.js:119)
  and consistent use of validated scalar params; search strings are escaped with
  regex escape (`enquiryController.js:218`, `reportsController.js`).
- **XSS:** React escapes by default; `dompurify` is bundled but unused
  (`utils/sanitizeHtml.js` has no importer). Backend strips HTML from enquiry
  input (`enquiryController.js:13-19`). React `dangerouslySetInnerHTML` — grep
  shows none in active components (MessageBubble renders plain text).
- **Mass assignment:** `updateDiet` (`dietController.js:63`) passes `req.body`
  wholesale to `findByIdAndUpdate`; `updatePackage` passes `req.body` to
  repository — no field whitelist on the update path (package update is
  superadmin-only; diet update is not). `updateField` also spreads `req.body`.

## Error leakage

- Global `errorHandler.js` returns sanitized JSON with `requestId`. Controller
  try/catch paths (attendance/reports/enquiry) return generic messages.
- `googleSheetsConnectorController` echoes `error.message` in the callback
  response (`:81`), which can leak Google API error internals.

## Headers

- helmet + CSP: `default-src 'self'`, `script-src 'self'` (no inline scripts),
  `style-src 'unsafe-inline'`, `frame-ancestors 'none'`, HSTS in production
  (`securityHeaders.js`). Frontend uses inline `style={}` attributes (not blocked
  by CSP `style-src-attr` default behavior for element style attributes — note:
  CSP `style-src 'unsafe-inline'` covers attribute styles).
- Additional headers: nosniff, X-Frame-Options DENY, Referrer-Policy,
  Permissions-Policy.
