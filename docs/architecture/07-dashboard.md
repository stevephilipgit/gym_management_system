# 07 — Dashboard

The admin dashboard (`/admin`) is a **finance/revenue dashboard**, not an
attendance dashboard. `AdminDashboardHome.jsx` drives it.

## Page → API → Controller → DB

| Widget | Frontend | Endpoint | Controller | DB |
|--------|----------|----------|------------|-----|
| Today's revenue cards | `AdminDashboardHome.jsx:68` | `GET /finance/summary/today` | `paymentController.getTodayDashboardSummary` (paymentController.js:207) | `DailySummary.findOne({date: today})` + `FinanceLog.find({date: today})` |
| Custom range report | `AdminDashboardHome.jsx:85,234` | `GET /finance/income?from&to` | `paymentController.getIncomeSummaryByDateRange` (223) | `FinanceLog.find({date range})` + `Member.aggregate` (count by trainingType) |
| Age distribution chart | `AdminDashboardHome.jsx:145` | `GET /finance/analytics/age-distribution` | `getAgeDistribution` (277) | `Member.aggregate` ($bucket by computed age) |
| Source contribution chart | `AdminDashboardHome.jsx:146` | `GET /finance/analytics/source-contribution` | `getSourceContribution` (319) | `PaymentLog.aggregate` ($group by paymentMode) |
| Plan distribution chart | `AdminDashboardHome.jsx:147` | `GET /finance/analytics/plan-distribution` | `getPlanDistribution` (347) | `FinanceLog.aggregate` ($group by plan) |
| PDF export | `AdminDashboardHome.jsx:115` | `POST /analytics/export-pdf` | `analyticsController.exportPDF` (analyticsController.js:24) | `analyticsService.getAnalyticsMetrics` → `PDFGenerator.generateAnalyticsPDFFromFinanceData` |

The dashboard fetches today's data and analytics on mount, polls every **30
seconds** (`AdminDashboardHome.jsx:180-184`), and re-fetches on midnight
rollover. There is a manual refresh plus a date-range picker.

## Widget data flow example (Today's summary)

```
AdminDashboardHome.jsx:68  apiClient.get("/finance/summary/today")
  → paymentController.getTodayDashboardSummary (207)
    → DailySummary.findOne({date: today})             — pre-aggregated (see summaryService)
    → FinanceLog.find({date: today}).sort({date:-1})  — recent transactions list
    → normalizeSummaryPayload → { totalAmount, newVsRenew, logs, plans,
                                  trainingTypes, memberCountsByTraining }
  → AdminDashboardHome renders cards + charts
```

## DailySummary maintenance

`services/summaryService.js`:
- `getTodaySummary()` — get-or-create today's doc.
- `updateTodaySummary(financeLog)` — atomic `$inc` on totals + per-plan and
  per-trainingType map keys. Called from member registration (new), renewal,
  and paymentController.recordPayment.
- `markPreviousDayComplete()` — flips `isCompleted` for yesterday (midnight
  task, `initDailyTasks`, checks every 60s).
- `rebuildTodaySummary()` / `rebuildLastSevenDays()` / `getDiagnostics()` —
  recovery utilities, not wired to any route.

**Data-consistency note:** `updateTodaySummary` is called in a few places but
not everywhere money moves; `recordPayment` (paymentController.js:54) creates
FinanceLog + PaymentLog + summary, while member registration creates FinanceLog
+ PaymentLog + summary inline. There is no transactional rollback between the
three writes — a failure mid-sequence leaves logs and summary out of sync until
a manual rebuild.

## Performance classification

| Item | Class |
|------|-------|
| 30s polling on dashboard | MEDIUM (5 requests every 30s; acceptable at small scale) |
| `FinanceLog.find({date: today})` unbounded (no limit on logs list) | MEDIUM (grows daily) |
| `Member.aggregate` age bucket — no `createdAt` index usage issue; scans all members when no date range | MEDIUM |
| Frontend re-fetches `/admin/me` 4× across app | LOW |
| No attendance metrics on dashboard | n/a (attendance shown on AttendanceFrontDesk page instead) |

The `/finance/analytics/*` routes use `sensitiveLimiter` (50/min).
