# 12 — Reports

`reportsRoutes.js` — all `adminAuth` (no role gate), `reportsController.js`.

## Endpoints

| Endpoint | Controller | DB | Gender scope |
|----------|------------|-----|--------------|
| `GET /reports/inactive?days&skip&limit` | `getInactiveMembers` (reportsController.js:13) | `Member.find({status:'active', $or:[lastAttendanceDate < threshold, null]})` | ✅ Filter applied (19-30). ⚠️ `total` count at :56-62 **omits** the gender filter → count mismatch. |
| `GET /reports/export/attendance` | `exportAttendanceCSV` (:100) | `Attendance.find(date range)` populated member | ❌ **MISSING.** Any admin can export ALL genders' attendance CSV. |
| `GET /reports/export/members` | `exportMembersCSV` (:145) | `Member.find` | ✅ Filter applied (149-160). |
| `GET /reports/export/inactive` | `exportInactiveReport` (:208) | `Member.find` (inactive query) | ❌ **MISSING.** No gender filter. |

## Frontend

- `InactiveReportsPage.jsx` (route `/admin/inactivity-reports`, all roles):
  - `GET /reports/inactive` (raw fetch, L19-22) — list with client-side pagination.
  - `GET /reports/export/inactive` (raw fetch, L56-59) — CSV download via
    `downloadCSV`.
- `AdminDashboardHome.jsx` → `POST /analytics/export-pdf` — analytics PDF
  (finance, not member gender data).

## Findings

1. **`exportAttendanceCSV` and `exportInactiveReport` ignore gender scope** —
   a male trainer can download female + transgender attendance/member data.
   **MEDIUM-HIGH risk.**
2. `getInactiveMembers` total count leaks the unfiltered total (**LOW**).
3. All report routes are `adminAuth`-only; `finance` role (scope all) can read
   every report — consistent with finance being revenue-wide.
4. Reports use `lastAttendanceDate` (Member field) for inactivity; there is no
   attendance-aggregation report besides the raw CSV.
5. CSV generation is manual string interpolation with `"` escaping
   (generateAttendanceCSV etc.) — no injection concern for CSV itself but values
   are not re-sanitized; data originates from validated member/enquiry fields.
