# 27 — Production Hardening Implementation Record

This document records the production-hardening implementation performed on the
Giri Gym application. It is a change log with evidence, not a design proposal.
Each section maps to the phase of the hardening plan it satisfies.

Implementation date: 2026-08-21 · Branch: `feature/gender-scope-access-control`

---

## 1. Per-device session model (Phase 1–2)

### New model — `backend/src/models/AdminSession.js`
- Each login creates one `AdminSession` document: `sessionId` (unique), `adminId`
  (indexed), `createdAt`, `expiresAt` (refresh expiry), `revokedAt` (null = active),
  `deviceName` (User-Agent), `ip`, `lastSeenAt`.
- Indexes: `sessionId` unique, `{adminId, revokedAt}`, `createdAt`, `expiresAt`.

### Admin lifecycle — `backend/src/models/Admin.js`
- Added `status: enum ["active","disabled"]` (default `active`).
- Added `tokenVersion: Number` (default `0`).

### Token claims — `backend/src/controllers/authController.js` (`issueTokens`)
- Access JWT now carries `sid` (session id), `tv` (tokenVersion), `jti`.
- Refresh JWT carries `sid`, `tv`, `jti` so rotation stays bound to the session.

### `adminAuth` rewrite — `backend/src/middleware/adminAuth.js`
Per authenticated request, verifies:
1. access JWT (signature/expiry)
2. admin exists **and** `status === "active"`
3. `admin.tokenVersion === decoded.tv`
4. session exists, not revoked, not expired (`AdminSession.findOne`)
5. attaches `req.admin` (role/scope from the DB — fresh) + `req.sessionId`

Consequences (verified by code):
- **Logout on Device B revokes only Device B's session** → A and C unaffected.
- **Password change / OTP reset / admin disable / role or scope change bumps
  `tokenVersion` and revokes all sessions** for that admin.
- **Deleted/disabled admins are rejected immediately** (adminAuth loads the admin
  from the DB every request).
- Existing pre-deployment tokens (no `sid`) are rejected with 401 → users must
  re-login once. This is the intended behavior change of the session model.

### Auth endpoints — `backend/src/routes/adminRoutes.js`
- `POST /api/admin/logout` no longer requires `adminAuth` (best-effort revoke via
  `ignoreExpiration` decode) so logout works with an expired token. Revokes the
  **current** session only.
- Added `POST /api/admin/logout-all` (adminAuth) — revokes every session of the
  current admin.

---

## 2. Centralized scope mechanism (Phase 3–4)

### `backend/src/core/scopeResolver.js`
Single source of truth. New reusable helpers:
- `getScopeAllowedGenders(req)` → `["Male"]` | `["Female","Transgender"]` | all
- `buildGenderFilter(req)` → `{}` or `{gender: {$in: [...]}}`
- `getScopedMemberIds(req, MemberModel)` → member `_id`s for scoped collections
  (returns `null` = unrestricted)
- existing `checkMemberScope(req, gender)` / `verifyAdminScope` preserved

All controllers now consume these helpers instead of inlining the scope map
(previous 10 duplicated inline maps removed from member/enquiry/report/
attendance controllers). The scope is always derived from `req.admin.scope`
(signed JWT, refreshed from DB per request) — never from query/body params.

---

## 3. Attendance scope enforcement (Phase 8)

`backend/src/controllers/attendanceController.js`:
- **`searchPunch`**: after member lookup, `scopeResolver.checkMemberScope`.
  Out-of-scope members return the same `404 Member not found` as a missing
  member — no existence leak.
- **`punch-manual`**: loads the member and scope-checks before `mark_entry`/
  `mark_exit` (404 for out-of-scope).
- **`getTodayStats`**: scoped — trainers count only their allowed genders'
  attendance via `getScopedMemberIds`; superadmin counts everything
  (`attendanceService.getTodayStats(memberIds)` now accepts an optional array).

`backend/src/routes/attendanceRoutes.js`: added a dedicated `searchPunchLimiter`
(60/min/IP) to cap gymId/phone enumeration on the kiosk lookup.

---

## 4. Enquiry scope fix + public gender (Phase 10)

`backend/src/controllers/enquiryController.js`:
- **Removed the `?gender=` scope override.** The client gender filter may now
  only *narrow* a superadmin scope (it must be inside the allowed set); trainer
  scopes always use the scope-derived filter. Same rule in `getEnquiries` and
  `exportEnquiriesCSV`.
- Per-record checks in `getEnquiryById` / `updateEnquiryStatus` now use
  `scopeResolver.getScopeAllowedGenders`.
- Public `submitEnquiry` accepts an optional validated `gender`
  (`Male`/`Female`/`Transgender`, default `Male`) and stores it.

`frontend/src/components/features/enquiry/EnquiryModal.jsx`: added a required
gender selector (sent to the API).

---

## 5. Reports scope enforcement (Phase 11)

`backend/src/controllers/reportsController.js`:
- `exportAttendanceCSV`: attendance restricted to the trainer's member scope via
  `getScopedMemberIds` (superadmin unrestricted).
- `exportInactiveReport`: applies `buildGenderFilter`.
- `exportMembersCSV` and `getInactiveMembers`: now use `buildGenderFilter`; the
  **total count** now includes the gender filter (was leaking the unfiltered
  total).

---

## 6. Diet gender scope + DELETE gate (Phase 9)

- `backend/src/models/Diet.js`: added `gender` enum
  `["All","Male","Female","Transgender"]` (default `All`, indexed). Existing
  diets remain `All` (visible to everyone) — backward compatible.
- `backend/src/controllers/dietController.js`: rewritten around a central
  `allowedDietGenders(req)` helper:
  - male scope → `All + Male`; female_plus_transgender → `All + Female +
    Transgender`; superadmin → everything.
  - `GET /` and `GET /:id` only return diets inside the caller's scope.
  - create/update clamp the requested gender to the caller's scope (403 on
    out-of-scope gender).
- `backend/src/routes/dietRoutes.js`: `DELETE /:id` now requires
  `requireRole("superadmin")` (was adminAuth-only — a trainer could delete diets).
- `backend/src/schemas/dietSchema.js`: `gender` field validated.
- `frontend/src/admin/AdminDietManager.jsx`: gender selector + delete button
  hidden for non-superadmins (backend remains the boundary).

---

## 7. Member search scope fix + registration gender (Phase 5–7)

- `memberController.getAllMembers` with `?search=` now passes the gender filter
  to `memberRepository.search(search, filters)` — the search path can no longer
  list all genders.
- All remaining inline scope maps in memberController replaced with
  `scopeResolver.buildGenderFilter`.
- `frontend/src/admin/AdminRegister.jsx`: added a **scope-aware gender dropdown**
  (all genders for superadmin; only the trainer's allowed gender(s) otherwise).
  Fixes the previous hardcoded `gender: "Male"` submission.

---

## 8. Admin creation requires explicit scope (P0-8)

- `backend/src/schemas/authSchema.js` `createAdminSchema`: `role` and `scope` are
  now **required**.
- `backend/src/controllers/authController.js` `createAdmin`: validates scope and
  **rejects `trainer` + `scope: "all"`** — trainers must have a gender scope.
  Removed the unsafe `scope = "all"` default.
- `backend/src/seed.js`: seeded admins now include male trainer + female trainer
  (scoped) instead of one unscoped trainer.

---

## 9. Upload hardening (Phase 18)

- `memberRoutes.js`: member photo upload now has the **2 MB limit** (matching
  `/api/uploads`) and writes to an **absolute path** (`backend/src/uploads`)
  consistent with `express.static` serving in `server.js` (previously
  cwd-relative — could write to a directory that was never served).
- `uploadRoutes.js`: same absolute path.

---

## 10. Audit logging wired (Phase 22)

- `server.js`: `app.locals.auditLogModel = AuditLog` — semantic audit events
  (`auditActions.*`) now persist to the `auditlogs` collection (previously only
  Winston files because the model was never attached).
- `middleware/requestLogger.js` schema extended with `adminUsername`,
  `requestId`, `resourceType`, `resourceId`, `changes`, `details` so semantic
  entries keep their metadata (Mongoose strict mode would have stripped them).
- No secrets are logged (verified: no password/token/OTP in any logger call).

---

## 11. Dashboard superadmin-only (Phase 12)

- `financeRoutes.js` + `analyticsRoutes.js`: every route now requires
  `requireRole("superadmin")`.
- `App.jsx`: `/admin` index (Dashboard) wrapped in `RoleGuard
  roles={["superadmin"]}`.
- `RoleGuard.jsx`: default redirect changed from `/admin` → `/admin/members`
  (avoids an infinite redirect for trainers landing on `/admin`).
- `AdminSidebar.jsx`: Dashboard item is now superadmin-only.

> Side effect to confirm with product: the `finance` role also loses dashboard
> access (Phase 12 says "Only SUPERADMIN gets Dashboard").

---

## 12. Frontend session/API consistency (Phase 15, 19)

- `AttendanceFrontDesk.jsx`, `InactiveReportsPage.jsx`, `DietSelector.jsx` now
  use the axios `apiClient` (401 auto-refresh) instead of raw `fetch`.

---

## 13. Config (Phase 19)

- `server.js`: optional `TRUST_PROXY=1` env to enable `app.set("trust proxy", 1)`
  so `req.ip` and IP-based rate limiting work behind nginx/cloud LB (off by
  default; the deployment must set it in production).

---

## 14. Tests (Phase 23)

- `src/tests/security.test.js` (unit, no DB — **runs in CI/dev without Mongo**):
  - updated `createAdminSchema` cases (scope now required; invalid scope
    rejected; removed `finance` role rejected)
  - new `scopeResolver` suite: superadmin/male/female+transgender access matrix,
    `buildGenderFilter` outputs, and "client scope cannot widen trainer scope".
  - new member update/renew schema cases: `version` is mandatory
    (optimistic concurrency).
- `src/tests/scopeAndSessions.test.js` (integration, **requires MongoDB**;
  auto-skips when unreachable):
  - per-device session revocation (Device A logout leaves Device B active)
  - tokenVersion bump invalidates outstanding tokens
  - scoped `getTodayStats` returns only the trainer's genders.

## 15. Role model simplification — finance removed

Per the production requirement, only **superadmin** and **trainer** roles exist.

- `Admin.role` enum: `["superadmin", "trainer"]`.
- `createAdminSchema` and `authController.createAdmin` reject `finance`; a
  trainer **must** declare a gender scope (`male` or `female_plus_transgender`)
  and `scope: "all"` is rejected for trainers.
- `adminAuth` rejects any non-canonical role (legacy `finance` accounts in an
  existing DB can no longer authenticate — they must be re-created or fixed).
- `seed.js` seeds three accounts: superadmin, male trainer, female trainer.
- Frontend `AdminHeader` role labels no longer include Finance.
- Finance-related endpoints (`/api/finance/*`, `/api/analytics/*`) remain
  superadmin-only (the Dashboard).

## 16. Optimistic concurrency for member edits (two trainers, same member)

`Member.version` (integer, default 0) is incremented atomically on every
update/renew. Clients must send the `version` they loaded:

- `PUT /api/members/:gymId` and `PUT /api/members/renew/:gymId` now require
  `version` (Joi + controller).
- `memberRepository.updateByGymId(gymId, data, expectedVersion)` performs
  `findOneAndUpdate({ gymId, version: expectedVersion }, { ...data, $inc: { version: 1 } })`.
- If the stored version no longer matches (another trainer already saved),
  the write returns null → controller re-checks existence and responds
  **409 Conflict** ("modified by another user — please reload") vs **404** when
  the member was deleted.
- Frontend: `RegisterForm`/`AdminUpdate`/`AdminMembers` send the loaded
  `version` and surface the 409 message with a reload prompt.

Two male trainers editing the same member simultaneously can no longer
silently overwrite each other — the second writer is rejected with 409.

Attendance is unaffected (append-only per `{memberId, date}` unique index +
state machine; concurrent double punches resolve via the unique index).

## 17. Regression / build verification

| Check | Result |
|-------|--------|
| Backend `node --check` (all changed files) | PASS |
| Backend module import smoke test (48 modules) | PASS |
| Backend unit tests (`security.test.js`) | PASS — 28/28 |
| Backend integration tests (`scopeAndSessions.test.js`) | SKIPPED locally (no MongoDB); pending in CI with a DB |
| Frontend ESLint (`npm run lint`) | PASS — no new errors in modified files |
| Frontend production build (`npm run build`) | PASS |

## 19. Admin management module (superadmin) + package gender + filters

Added on top of the hardening pass, per the product requirement (only
superadmin, male trainers and female trainers exist):

### Admin account management (`frontend/src/admin/AdminManageAdmins.jsx`)
- New superadmin-only page at `/admin/admins` (sidebar: System → Admin Accounts).
- **Create** male/female trainer credentials: full name, username, email,
  password, role (trainer/superadmin), and **Gender Scope** (locked to
  `male` or `female_plus_transgender` for trainers — `all` is not an option
  for a trainer).
- **List** all admins; **edit** role/scope/status; **disable/enable** (revokes
  all sessions); **reset password** (shows a temporary password); **delete**
  (removes account + sessions).
- Backend endpoints already existed and are superadmin-gated
  (`POST /api/admin/create`, `GET /api/admin/list`, `PUT /api/admin/:id`,
  `POST /api/admin/reset-password/:id`, `DELETE /api/admin/:id`).

### Package gender scoping (`models/Package.js`, `controllers/packageController.js`)
- `Package.gender`: `All | Male | Female | Transgender` (default `All`, so
  existing packages remain visible to everyone).
- `GET /api/packages` is **scope-filtered**: male trainer → `All + Male`;
  female trainer → `All + Female + Transgender`; superadmin → everything.
- Superadmin can **narrow** with `?gender=` (the Packages page filter);
  a trainer's scope can never be widened via the query string.
- `AdminManagePackages.jsx`: gender field in the create/edit form, a Gender
  column in the table, and a superadmin filter dropdown.
- Registration dropdown (`AdminRegister`/`AdminMembers`) loads packages via the
  scoped endpoint, so a male trainer only sees male packages when registering.

### Gender filters for superadmin
- `AdminMembers` (member management) and `AdminDues` (due members): a gender
  filter dropdown is shown only when `admin.scope === "all"`. Backend supports
  `?gender=` narrowing for superadmin on `GET /members`, `GET /members/due/list`,
  and `GET /packages`; trainers never receive the filter UI and the backend
  ignores `?gender=` for non-superadmin scopes.

### Diet gender locked for trainers
- `dietController`: trainers can no longer pick diet gender — the client value
  is **ignored** on create (locked to `Male` for male scope, `Female` for
  female_plus_transgender scope) and **rejected with 403** on update if a
  gender is sent. Only superadmin selects gender when creating a diet.
- `AdminDietManager.jsx`: the Gender Scope dropdown is hidden for trainers
  (locked note shown); superadmin sees the full selector.
- The register form's "Include Diet Plan" dropdown (`GET /diets`) is scoped, so
  a male trainer only sees male diets (a female trainer only her diets).

## 18. Remaining risks / UNKNOWN

1. Enquiry gender defaults to `Male` for API callers that omit it (public form
   now sends it).
2. Legacy sessions are invalidated once on deploy (users re-login) — expected.
3. Legacy `finance` accounts (if any exist in a pre-existing DB) cannot log in
   and must be re-created with a trainer scope.
4. CSRF: still SameSite=Strict + CORS only (no CSRF token). Acceptable for
   same-site deployment; a double-submit token is a P2 candidate.
5. `TRUST_PROXY` must be enabled on the production deployment or rate limiting
   and audit IPs collapse to the proxy IP.
6. Attendance double-punch race (two requests for the same member in the same
   instant) is safe via the unique `{memberId, date}` index, but the second
   request surfaces a 500 instead of a clean 409 — a P2 polish item.
