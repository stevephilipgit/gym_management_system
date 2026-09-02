# 30 — Customer-Facing Attendance (Kiosk + Daily Report)

> **SUPERSEDED (historical)**: The pre-refactor description below ("admins and
> trainers do not punch attendance") is no longer accurate. The current,
> authoritative documentation is
> [`ATTENDANCE_DEVICE_ARCHITECTURE.md`](ATTENDANCE_DEVICE_ARCHITECTURE.md).
> Trainers (MODE 1) and Super Admins (MODE 2) now perform scoped attendance;
> the customer kiosk page still exists for the Trainer device flow. This file
> is retained for audit trail only.

## What Attendance Is For

Attendance is a **customer** feature. Customers use one public page
(`/kiosk-attendance`) to check in when they arrive and check out when they
leave. Male, Female and Transgender customers all use the **same page** — there
is no per-gender page and no login.

Admins/trainers do **not** punch attendance. They only view attendance through
their existing admin screens and receive a daily CSV report.

## How Customers Punch

```
Customer enters Gym ID (or phone)
   ↓
POST /api/attendance/kiosk/punch
   ↓
identity is resolved (0 / 1 / many members)
   ↓
one member        → punch immediately
many members      → picker ("Who are you?") → selection → punch
no member         → "Member not found."
```

The normal flow is **one action, one request**. A customer checks in with their
Gym ID, works out, then enters the Gym ID again to check out.

## Why Gym IDs Can Overlap

`gymId` is a number that is only unique **within a gender**:
- Male Gym uses its own sequence: `1, 2, 3, ...`
- Female + Transgender share one sequence: `1, 2, 3, ...`

So **Male `192` and Female `192` are two different members**. This is
legitimate, not a bug.

### Example

- Male Gym ID `1001` → **Saravana**
- Female Gym ID `1001` → **Sanjana**

### How Male/Female duplicate IDs are handled

When a customer enters `1001`, the system searches **all genders**. If both
Saravana and Sanjana match, it does **not** guess. It shows a picker:

```
Who are you?

  Saravana  · Male  · M1001
  Sanjana   · Female · F1001
```

The customer taps their own name. The server verifies a short-lived signed
**selection token** bound to exactly one member, reloads that member fresh,
re-checks eligibility, and punches. The wrong person's attendance can never be
created.

### How Female/Transgender IDs work

Female and Transgender share **one** numeric sequence (there is no separate
"T" counter). Example: `Female 192`, `Transgender 193`, `Female 194`.

If the database ever contains `Female 192` **and** `Transgender 192` at the
same time, that is **data corruption**. The system refuses to punch
(`integrity_error`) and logs it — it never silently picks one. This is checked
at punch time because the database index alone cannot enforce uniqueness across
the Female+Transgender group.

## What memberCode Is For

`memberCode` (e.g. `M1001`, `F1001`) is a **secondary, internal** identifier.
Customers do not enter it. It is used:
- to display in the ambiguity picker, and
- as an exact post-picker selection signal.

## Why Member._id Is the Attendance Identity

Every `Attendance` record stores `memberId → Member._id` (the real database id
of the member). Gym ID is only a **lookup input**. Persisting identity by
`Member._id` is what keeps Male `1001` and Female `1001` completely separate.

The daily CSV report also joins by `Attendance.memberId → Member._id` — never
by Gym ID — so the two overlapping IDs never get mixed up.

## How Check-in Works

First Gym ID entry of the day → the server creates an `Attendance` document
with `date` = the calendar day of the check-in, `checkInTime` = now, and
state `inside` (or `late` if after the late threshold).

## How Check-out Works

Second Gym ID entry of the same day → the server updates the existing record:
`checkOutTime` = now, `durationMin` = time inside, state `completed`.

The attendance belongs to the **check-in day**. If someone checks in at
23:58 and checks out at 00:20, the record stays on the check-in day.

## How Duplicate Punches Are Prevented

- A short duplicate-punch window blocks a second punch within N seconds.
- Once a member has checked in and out, a third punch the same day is rejected
  ("Attendance already recorded").

## How Race Conditions Are Handled

Two rapid requests for the same member + day cannot create two records:

- **Check-in:** the database enforces a **unique index on `{memberId, date}`**.
  The first request creates the record; the second hits the unique constraint
  and receives a clean "already checked in" response.
- **Check-out:** the update requires `checkOutTime == null`, so only the first
  check-out wins.

The database constraint is the final authority — no application mutexes.

## What Happens When the Member Is Expired/Inactive

At punch time the server re-checks the **current** member state:

- not active → rejected
- membership expired beyond grace (or missing `validityEnd`) → rejected
- outside business hours → "Gym is closed"
- `paymentStatus` is **not** an attendance gate (informational only)

## How the Public Kiosk Is Protected

The page is public, but the backend punch endpoint requires a **trusted device
credential** (`X-Kiosk-Id` + `X-Kiosk-Key`, bcrypt-verified). This identifies
"this request comes from an approved attendance device", **not** the customer.

- Customers never see or configure the credential.
- A disabled/rotated kiosk stops working immediately.
- The kiosk has **no gender scope** and is never an admin principal.
- The endpoint is rate-limited (per-IP and per-device) and accepts a strictly
  validated payload (exactly one of `input` / `memberCode` / `selectionToken`).

### Device provisioning (staff only)

The customer page has **no configuration form**. Staff provision a device on a
separate, unlinked page: `/kiosk-setup`. There they enter the Kiosk ID and API
Key issued by the superadmin (via `POST /api/admin/kiosks` or
`node scripts/createKiosk.js`). If a device is not configured, the customer
page simply shows "Attendance kiosk is unavailable. Please contact gym staff."

## How Customer Privacy Is Protected

The kiosk is a shared physical screen, so:

- Customer identity is **ephemeral** — never written to localStorage,
  sessionStorage, the URL, or any configuration.
- Input, candidates, results and errors are cleared after success, error,
  cancel, or a **30-second inactivity reset**.
- A stale response for a previous customer is never rendered into the next
  customer's session.
- The punch result modal shows only Name, Gym ID, Check-in/out, Duration,
  Plan and expiry — **no phone number** (phone stays in admin-only views).

## How the Previous-Day CSV Is Generated

Every night a scheduled job runs at **00:05 IST**:

```
previous day (IST)
   ↓
atomically claim "one export per date"
   ↓
stream attendance for that date (Attendance.date)
   ↓
join each row to its member by Member._id
   ↓
write a safe CSV (quoted, CRLF, formula-injection protected)
   ↓
verify the file
   ↓
mark READY
   ↓
create a Super Admin notification
```

Rows are processed in batches of 500, so memory stays small even for large
days. Ordering is deterministic (`date, checkInTime, _id`) so the file is
reproducible.

If nobody attended, the CSV still gets a header row and the admin is notified —
an empty day is not ambiguous.

### CSV columns

`Date, Gym ID, Name, Gender, Member Code, Check-in, Check-out, Duration (min), Status`

Phone, Aadhaar, medical, address, father name, payment status and days-left are
deliberately **not** included.

## Where the Report Is Stored

Files are written to `backend/exports/` (outside the public `/uploads` tree so
they are never directly downloadable). The filename is deterministic:
`attendance-YYYY-MM-DD.csv`. The `exports` directory must be a **persistent
volume** in Docker/VM deployments.

## How the Admin Is Notified

After the CSV is verified, an in-app notification is created (the bell in the
admin header). It says, for example:

> Daily attendance report ready
> Previous day attendance report (2026-08-30) is ready.

Notifications contain **no member PII**. Only Super Admins receive them (the
report is a cross-gender audit artifact).

## How the Admin Downloads It

The Super Admin opens the notification and clicks **Download report**. The
download goes through an authenticated endpoint
(`GET /api/exports/attendance/:reportId/download`, adminAuth + superadmin) which
validates the report record and streams the file. Customers and kiosk
principals can never reach it.

## What Happens When Export Fails

- No "ready" notification is created.
- The export record is marked `failed` with a reason; a partial temp file is
  removed.
- The next scheduled run retries safely.

## How Retries Work

- Same date + same export type = **one export record** (unique index). A second
  cron run finds the existing record and does nothing if it is already ready.
- A crash mid-generation leaves `status: generating`; after a safe timeout the
  next run reclaims it and finishes the job.
- If the file was generated but the notification failed, a retry sweep sends
  the notification **without regenerating the CSV**.

## Timezone

The authoritative business timezone is **Asia/Kolkata (IST)**. It is set via
`process.env.TZ` at the top of `server.js` before any date logic runs, and the
cron jobs pass `{ timezone: "Asia/Kolkata" }` explicitly. `Attendance.date`,
business hours, the late threshold, auto-close and the daily export all use IST.

## Important Limitations / Known Risks

- **Female+Transgender sequence integrity** is enforced at punch time (runtime
  check), not by a database constraint. MongoDB cannot express "unique across a
  gender group" as a plain index. Corrupt data is refused, never guessed.
- **Rate limiting is in-memory** (per process). With a single backend instance
  that is correct; if the app is ever scaled to multiple instances, the kiosk
  limiters should move to a Redis store.
- **Google Sheets sync is legacy and best-effort.** It never determines identity
  or punch success.
- **The CSV report is an audit artifact, not a backup** of MongoDB. It is a
  human-readable daily extract; the database remains the source of truth.
- **Report retention** is configurable (default 90 days) with a cleanup job.
  Until a retention policy is approved, files are kept; auto-deletion only
  happens once configured.

## Files

Backend: `models/Kiosk.js`, `models/AttendanceExport.js`, `models/Notification.js`,
`middleware/kioskAuth.js`, `services/kioskService.js`,
`services/attendanceEligibilityService.js`, `services/attendanceExportService.js`,
`services/notificationService.js`, `controllers/kioskController.js`,
`controllers/kioskAdminController.js`, `controllers/notificationController.js`,
`routes/kioskRoutes.js`, `routes/kioskAdminRoutes.js`, `routes/notificationRoutes.js`,
`utils/attendanceInput.js`, `utils/csvSafety.js`, `jobs/attendanceJobs.js`,
`jobs/attendanceDailyExportJob.js`, `server.js`, `scripts/createKiosk.js`,
`tests/kiosk.test.js`, `tests/export.test.js`.

Frontend: `pages/KioskAttendance.jsx`, `pages/KioskSetup.jsx`,
`components/shared/PunchModal.jsx`, `utils/kioskApiClient.js`,
`utils/kioskIdentity.js`, `admin/AdminHeader.jsx`.
