# 11 — Attendance

## Architecture

- Model: `models/Attendance.js` — `memberId` (ref Member), `date`, `checkInTime`,
  `checkOutTime`, `durationMin`, `state` (inside/completed/auto_closed/late),
  `source` (counter/kiosk/manual/startup_recovery), `correctedBy`, `notes`.
  Unique index `{memberId, date}`. **No gender stored on Attendance** — gender
  derives from the Member (the intended design).
- Service: `services/attendanceService.js` — `markAttendance`, `validateMemberExpiry`,
  `checkDuplicate`, `autoCloseOpenRecords`, `getTodayStats`, `getLastAttendance`
  (unused).
- Jobs: `jobs/attendanceJobs.js` — `autoCloseJob` (23:59 cron), `staleAutoCloseJob`
  (every 30 min), `startupRecoveryJob` (on boot). Runs server-side with no request
  context (no scope concern).
- Routes: `routes/attendanceRoutes.js` — all behind `adminAuth`, none behind
  `requireRole`.

## Endpoint-by-endpoint scope status

| Endpoint | Behavior | Gender scope |
|----------|----------|--------------|
| `POST /attendance/search-punch` | Combined member search (by phone or numeric gymId) + punch. Used by the kiosk and counter. Resolves member → scope check → business checks (status, hours, expiry, duplicate, late) → creates/updates attendance → returns member PII. | ✅ **FIXED (hardening):** `scopeResolver.checkMemberScope` after member lookup; out-of-scope returns the same 404 as a missing member (no existence leak). Dedicated `searchPunchLimiter` (60/min/IP) added. |
| `POST /attendance/punch` | `markAttendance` with a memberId in the body. | ✅ Loads member, checks `scopeResolver.checkMemberScope(req, member.gender)` → 403 (attendanceController.js:333). |
| `POST /attendance/punch-manual` | Late-punch modal: `mark_entry`/`mark_exit` for a memberId. | ✅ **FIXED (hardening):** loads the member and scope-checks before both actions. |
| `GET /attendance/history/:memberId` | Attendance history for one member. | ✅ Scope check (attendanceController.js:512). |
| `GET /attendance/stats/today` | Today's punch counts. | ✅ **FIXED (hardening):** trainers count only their allowed genders via `getScopedMemberIds`; superadmin counts everything. |
| `GET /attendance/logs` | Filtered attendance listing (date range + search). | ✅ DB-level filter: `memberFilter.gender = {$in: allowedGenders}` built from `req.admin.scope` via `scopeResolver` (attendanceController.js:583-597). Query params `gender`/`memberId`/`gymId`/`search` cannot override it. |

## Kiosk flow (frontend/src/pages/KioskAttendance.jsx)

- `/kiosk-attendance` is a **public page** (App.jsx:47) but calls
  `POST /attendance/search-punch`, which requires `adminAuth` (cookie). So the
  page renders publicly, but punching requires a logged-in admin session.
- Input is numeric-only (`replace(/\D/g,"")`), so `M1001`-style codes are
  stripped to `1001` and matched against numeric `gymId`.
- No PIN gate (removed in commit `6a6fc1b`).

**Architectural concern (documented, per Part 5 spec §9):** with the PIN gate
removed, any logged-in session on a shared kiosk can punch any member — and
because `searchPunch` has no scope check, gender isolation is not enforced there.
The fix is to add the scope check inside `searchPunch`, keeping `adminAuth`.

## Attendance search input handling

`searchPunch` validates input via `validateSearchInput` (attendanceController.js:
37-70): numeric-only; 10 digits starting 6-9 → phone; else parsed as numeric
gymId. Non-numeric input ("M1001") is rejected with "Only numeric input allowed".
Member resolution uses `Member.findOne({phone|gymId})`.

## Punch behavior

```
searchPunch:
  1. validate + sanitize input
  2. Member.findOne({phone|gymId})      ← NO scope check here
  3. status !== active → 403
  4. business hours check → 403 gymClosed
  5. expiry check (calculateDaysLeft + grace) → 403
  6. duplicate punch check (30s) → 429
  7. late threshold → state "late"
  8. Attendance.findOne({memberId, date}) → create check-in OR check-out OR 409
  9. update Member.lastAttendanceDate
  10. sync to Google Sheets (non-blocking)
  11. respond with member details + attendance
```

## Gender scope rules (target state per Part 5)

- Male trainer → male members only; M1001 allowed, F1001/T1001 denied.
- Female trainer → female + transgender; F1001/T1001 allowed, M1001 denied.
- Superadmin → all.
- A trainer must not bypass via `?gender=`, `?memberId=`, `?gymId=`, body params,
  or attendance IDs.

## Current gaps (Part 5 work items)

All Part 5 access-control gaps have been **closed** in the hardening phase.
See [27-production-hardening.md](27-production-hardening.md) for the
implementation record.
