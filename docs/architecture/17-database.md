# 17 — Database Architecture

MongoDB (Mongoose 8.20). Single database. All models in `backend/src/models/`.

## Collections

| Collection | Model | Purpose | Key fields |
|------------|-------|---------|------------|
| admins | Admin | Admin users | username, email, role, scope, passwordHash, resetOtp, otpExpiry |
| members | Member | Gym members | gymId (num, unique), memberCode, fullName, gender, phone, aadhar, dob, gymPlan, trainingType, paymentStatus, validityEnd, status, lastAttendanceDate, customFields (Object), dietId |
| attendance | Attendance | Punch records | memberId (ref), date, checkInTime, checkOutTime, durationMin, state, source, correctedBy |
| payments | PaymentLog | Money-in records | gymId, name, plan, trainingType, amount, type (new/renewal), paymentMode, dietId, dietName |
| financelogs | FinanceLog | Revenue ledger | gymId, memberName, amount, plan, trainingType, type (new/renew), date |
| dailysummaries | DailySummary | Pre-aggregated per-day revenue | date (unique), totalRevenue, newJoiningRevenue, renewalRevenue, totalTransactions, incomeByPlan (Map), incomeByTrainingType (Map), membersByTrainingType (Map), isCompleted |
| packages | Package | Plans | name, months, priceWeightLoss/Gain/Transformation |
| diets | Diet | Diet plans | name (unique), description, isActive |
| dietmappings | DietMapping | Default diet per trainingType | trainingTypeId (unique), dietId |
| dynamicfields | DynamicField | Extra registration fields | key (unique), label, type, required, options, isEnabled |
| enquiries | Enquiry | Public leads | name, email, phone, preferred_branch, reason, message, status, gender, ip_address, user_agent, source_page |
| googleSheetsConnectors | GoogleSheetsConnector | Sheets sync state | adminEmail, isConnected, accessToken, refreshToken, spreadsheetId, lastRowIndex, errorCount |
| systemsettings | SystemSettings | Singleton settings | key='gym_rules', attendance/business/enquiry/branch/social/sheets fields |
| counters | Counter (atomicCounter) | Member-code sequences | key (unique, e.g. member_code_M), seq |
| auditlogs | AuditLog (requestLogger) | HTTP audit | userId, ipAddress, method, path, statusCode, userAgent, action, timestamp |

## Relationships

- Attendance.memberId → Member._id (ObjectId ref; unique `{memberId, date}`).
- Member.dietId → Diet._id (optional).
- PaymentLog.dietId → Diet._id (optional).
- DietMapping.dietId → Diet._id (unique `trainingTypeId`).
- DailySummary, FinanceLog, PaymentLog reference members **only by numeric
  `gymId`** (denormalized, no FK).
- Attendance/Counter/AuditLog reference admins by ObjectId (loose).

## Indexes (schema-defined)

- `members`: gymId (unique), aadhar (unique), phone (unique),
  phone+validityEnd, dob, gymPlan, createdAt, status, dob+createdAt,
  gymPlan+createdAt, lastAttendanceDate.
- `attendance`: memberId, date, checkInTime, `{memberId,date}` unique.
- `financelogs`: gymId, plan, trainingType, type, date.
- `enquiries`: status+createdAt, preferred_branch+status, createdAt, email, phone.
- `systemsettings`: key unique.
- `dailysummaries`: date unique, lastUpdatedAt, date+isCompleted.
- `dietmappings`: trainingTypeId unique.
- `diets`: name unique, isActive.
- `dynamicfields`: key unique.
- `counters`: key unique.
- `auditlogs`: userId+timestamp, action, timestamp TTL (90 days via script —
  see below).

`utils/dbIndexes.js` defines an *additional* set (applied by `scripts/applyIndexes.js`)
that includes a **stale `signedpdflinks`** collection (removed feature) and an
auditlogs TTL index (90 days). Note `seed.js` also creates indexes. The Mongo
schema-level indexes and script indexes overlap partially (duplicates).

## Query patterns (access patterns)

- Attendance listing: `Attendance.find({memberId: {$in: [...]}, date: {...}}).populate('memberId')`.
- Today summary: single `DailySummary.findOne({date})` (fast).
- Dashboard age bucket: `Member.aggregate` over all members (no index on dob
  query use; scans).
- Enquiries: filtered find with skip/limit.
- Inactive report: `Member.find({status:'active', lastAttendanceDate: ...})` —
  uses `lastAttendanceDate` index.

## Risks

- **Unbounded queries:** `exportAttendanceCSV` (`limit` default 5000),
  `exportEnquiriesCSV` (no limit), `FinanceLog.find({date: today})` on the
  dashboard (no limit), `getInactiveMembers` limit default 50 but client may
  pass large values.
- **N+1:** none significant (populate used); attendance CSV populates members
  in one query.
- **Missing index:** `attendance` queries join via memberId (indexed). The
  gender-filtered listing resolves member ids via `Member.find({gender})` then
  `attendance.find({memberId in})` — two queries but both indexed.
- **`members.customFields` is an Object** (unstructured) — no schema evolution.
- **No TTL on attendance/enquiries** — the enquiry cron handles cleanup; audit
  TTL is defined only in the applyIndexes script, so auditlogs grow unless the
  script is run.
- **Duplicate/overlapping indexes** between schema definitions and
  `utils/dbIndexes.js`.
- **`getAllMembers` gender filter bypass on `?search=`** (see 05/08).
