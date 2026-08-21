# 20 — Performance Audit

Purpose: find likely causes of the app feeling "slow and sloppy". Classified
CRITICAL / HIGH / MEDIUM / LOW.

## Backend

| # | Finding | Evidence | Class |
|---|---------|----------|-------|
| P1 | Dashboard fetches today's summary **and** the full FinanceLog list for today (`FinanceLog.find({date:today})` with no limit) | `paymentController.js:213-216` | MEDIUM |
| P2 | `FinanceLog.find({date range})` returns all matching logs to the frontend (no pagination/limit) on `/finance/income` | `paymentController.js:230` | MEDIUM |
| P3 | Attendance `searchAttendanceLogs` does two queries (Member.find then Attendance.find+count) — acceptable, both indexed | `attendanceController.js:614-636` | LOW |
| P4 | `getAgeDistribution` scans **all members** when no date range given (`Member.aggregate` no `createdAt` filter) | `paymentController.js:277-304` | MEDIUM |
| P5 | `exportAttendanceCSV` default limit 5000 + `exportEnquiriesCSV` has **no limit** (full collection in memory → CSV string) | `reportsController.js:120-125`, `enquiryController.js:393` | MEDIUM |
| P6 | `getInactiveMembers` + `exportInactiveReport` both re-query and re-compute `daysLeft` in JS | `reportsController.js:40-54, 218-245` | LOW |
| P7 | Report `total` count runs a second `Member.countDocuments` query | `reportsController.js:56-62` | LOW |
| P8 | `/attendance/search-punch` — several sequential DB calls per punch (settings cache, duplicate check, attendance find, update) — fine at small scale, but no bulk optimization | `attendanceController.js:102-311` | LOW |
| P9 | Multiple `Member.findById` loads in markAttendance (scope check + later full member load) | `attendanceController.js:324, 375` | LOW |
| P10 | `updateTodaySummary` is a `findOneAndUpdate` per transaction plus a prior `findOne` in `getTodaySummary` — 2 round trips per payment | `summaryService.js:76-129` | LOW |
| P11 | `searchPunch` runs `attendanceLogger.info` and Google Sheets sync path lookups (one connector query per punch) | `attendanceController.js`, `attendanceSyncService.js:12-14` | LOW |
| P12 | No aggregation on attendance trends; no attendance dashboards — attendance data is small | — | n/a |

## Database

| # | Finding | Evidence | Class |
|---|---------|----------|-------|
| D1 | Members/attendance/enquiry data at gym scale (hundreds–low thousands) — queries are well-indexed for the main paths | schema indexes (17-database.md) | LOW |
| D2 | AuditLog grows unbounded unless `applyIndexes.js` TTL (90d) is run; the TTL is **not** part of the mongoose schema | `utils/dbIndexes.js:50`, `middleware/requestLogger.js` | MEDIUM |
| D3 | Overlapping duplicate indexes between mongoose schema and `utils/dbIndexes.js` / `createIndexes.js` | 17-database.md | LOW |
| D4 | `dailySummary.incomeByPlan` Map with `$inc` on dotted keys — fine | — | LOW |

## Frontend

| # | Finding | Evidence | Class |
|---|---------|----------|-------|
| F1 | Dashboard polls **5 endpoints every 30 seconds** forever (no pause on idle/visibility) | `AdminDashboardHome.jsx:180-184` | HIGH |
| F2 | `GET /admin/me` fetched in 4 places independently (AuthGuard, AdminMembers, AdminRegister, RegisterForm) — 3 extra round trips per page | `Authguard.jsx:15`, `AdminMembers.jsx:77`, `AdminRegister.jsx:93`, `RegisterForm.jsx:86` | MEDIUM |
| F3 | Some pages use raw `fetch` (bypass axios interceptor) — on expired access they show errors instead of auto-refresh | `AttendanceFrontDesk.jsx:75`, `InactiveReportsPage.jsx:19-22,56-59`, `DietSelector.jsx:23,40` | MEDIUM |
| F4 | Large inline `style` objects and 4300-line CSS — bundle/first-paint cost is modest; not a correctness issue | `index.css`, feature pages | LOW |
| F5 | All routes lazy-loaded under a single Suspense — good code-splitting | `App.jsx:36-41` | LOW |
| F6 | AdminMembers renders an 823-line page with heavy modal state and re-fetches `/admin/me` + `/packages` on every open | `AdminMembers.jsx:59-95` | LOW |
| F7 | recharts charts re-render on every poll tick (new data objects each fetch) | `AdminDashboardHome.jsx` | MEDIUM |
| F8 | `AttendanceFrontDesk` auto-refreshes every 30s (no visibility pause) | `AttendanceFrontDesk.jsx:96-98` | LOW |
| F9 | `Home.jsx` hardcodes branch config + fallback prices — fine, no API dependency for marketing content | — | n/a |

## Runtime / infrastructure

| # | Finding | Evidence | Class |
|---|---------|----------|-------|
| R1 | Backend runs a single Node process (`npm start`) — no PM2 cluster in repo, no vertical scaling config | `DEPLOYMENT_GUIDE` describes PM2 but no process config exists in repo | LOW |
| R2 | Multer disk storage (no streaming to cloud) — sync I/O per upload; fine at this scale | `memberRoutes.js`, `uploadRoutes.js` | LOW |
| R3 | Winston file logging is synchronous on the hot path (log.info per punch with attendanceLogger) | `attendanceController.js` + `core/attendanceLogger.js` | LOW |
| R4 | Global JSON body limit 10mb parsed on every request | `server.js:116` | LOW |

## "Why does it feel slow/sloppy" — top contributors

1. **F1**: the dashboard never stops polling, even on background tabs.
2. **F2/F3**: duplicated auth fetches and raw-fetch pages that visibly error when
   the access token expires.
3. **P1/P2/P5**: unbounded list payloads (finance logs, CSV exports).
4. **P4**: age-bucket aggregation scans the whole member collection when no date
   range is supplied (the dashboard always supplies a range, so impact is
   limited).
5. No frontend caching layer (react-query absent) — every navigation re-fetches
   everything, no stale-while-revalidate.
