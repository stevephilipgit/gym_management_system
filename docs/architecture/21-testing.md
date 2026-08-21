# 21 — Testing & Reliability

## What exists

### Backend tests (`backend/src/tests/`)

1. **`attendance.test.js`** — Mocha + Chai, integration-style (requires a MongoDB
   at `MONGO_URI`/`mongodb://localhost:27017/gym_test`). Covers:
   - TEST 1 check-in creation, TEST 2 check-out, TEST 3 duplicate punch
     prevention, TEST 4 expired member block, TEST 5 daysLeft, TEST 7 auto-close,
     TEST 9 settings get/update, TEST 10 lastAttendanceDate update.
   - **No gender-scope tests, no HTTP/route tests, no auth tests.** Uses
     `attendanceService` directly, not the HTTP layer.

2. **`security.test.js`** — Mocha + Chai, **unit tests only** (no DB/Redis):
   - `requireRole` middleware (401/403/array roles).
   - `loginSchema`, `createAdminSchema`, `changePasswordSchema` validation.

Run: `cd backend && npm test` (mocha `src/tests/**/*.test.js`, 30s timeout).

### Frontend tests

**None.** No test files, no test script, no vitest/jest setup in
`frontend/package.json`.

### CI / lint / type checks

- **CI:** none found (no `.github/`, `.gitlab-ci.yml`, etc.).
- **Lint (frontend):** `npm run lint` → `eslint .` (flat config). No equivalent
  backend lint script.
- **Type checks:** none (no TypeScript).

## Feature → test coverage map

| Feature | Existing tests | Missing tests | Risk |
|---------|----------------|---------------|------|
| Login / CAPTCHA / refresh | loginSchema validation only | E2E login flow, captcha, refresh rotation, rate limit | MEDIUM |
| Authorization (requireRole) | unit tests | route-level tests per endpoint | MEDIUM |
| Gender scope | **none** | member/enquiry/attendance/report scope matrix; IDOR attempts | **HIGH** |
| Member register/renew/due | none | registration flow, gymId/memberCode generation, renewal | HIGH |
| Attendance punch/logs | service-level (markAttendance etc.) | searchPunch, punch-manual, stats/today, logs scope | HIGH |
| Packages | none | CRUD + superadmin gate | LOW |
| Diet | none | CRUD + delete gate | LOW |
| Finance/summary | none | summary consistency, dashboard endpoints | MEDIUM |
| Enquiries | none | public submit, honeypot, gender scope | MEDIUM |
| Reports/CSV | none | export scope | MEDIUM |
| Settings | none | read/write, whitelist, cache | LOW |
| AI | none | chat, confirmation, tool limits, injection patterns | MEDIUM |
| Google Sheets sync | none | connector, sync, failure | LOW |
| Frontend | **none** | any component/page test | MEDIUM |

## Reliability gaps

- Backend tests require a live Mongo (no mocking, no in-memory Mongo). They will
  fail without a local/Atlas DB; the `attendance.test.js` deletes all Attendance
  and Member rows in the connected DB (`cleanDB`) — **destructive if pointed at a
  real database**.
- No CI to enforce `npm test`/`npm run lint` on push.
- No security regression tests for the IDOR paths (C1/C2/H1/H2 in 19-security).
- No smoke/synthetic test for the public kiosk or the production build.
