# 08 — Members

## Member lifecycle (verified)

```
Register → validate → gender scope check → generate gymId + memberCode
  → create member → create FinanceLog + PaymentLog + update DailySummary
  → generate invoice PDF (jsPDF, client-side)
  → response

Update → load member → scope check → update fields → response
Renew  → load member → scope check → calculate new validity → create
         FinanceLog + PaymentLog + update DailySummary → invoice PDF
Dues   → getExpiringMembers (returns all active+expired with gender filter)
         → frontend client-side pagination
Delete → load member → scope check → superadmin-only → delete by gymId
```

## Gym ID / member code system

The system has **two parallel identifiers**:

| Field | Type | Example | Generation | Race-safe? | Gender-specific? |
|-------|------|---------|------------|-----------|------------------|
| `gymId` | Number | `1001`, `1002` | `last.gymId + 1` (memberController.js:34-37) | No (read-then-save, not atomic) | No (global sequence) |
| `memberCode` | String | `M1001`, `F1001`, `T1001` | Per-gender `Counter.increment("member_code_M")` + prefix + zero-pad (memberController.js:82-92) | ✅ Yes (atomic `$inc` via `findOneAndUpdate`) | ✅ Yes |

- `gymId` is a simple numeric auto-increment (no race safety under concurrent
  registration). Used by attendance search-punch and all member list displays.
- `memberCode` is the gender-specific M1001/F1001/T1001 identifier. Generated
  via the `atomicCounter.js` service (MongoDB `findOneAndUpdate` with `$inc`).
  Stored in `memberCode` field, **not** used by attendance search.
- Attendance search (`searchPunch`) accepts numeric input only and resolves via
  `gymId`. The `memberCode` is **not searchable** from the kiosk.

**Finding:** The spec requirement "Member IDs follow the previously implemented
sequence: Male: M1001, M1002..." is satisfied by `memberCode`. But attendance
uses `gymId` (numeric). The gender prefix is not searchable. This is a design
inconsistency for Part 5 resolution.

## Gender scope in members

All member endpoints are scoped by `req.admin.scope`:
- `register`: `allowedGenders` check (memberController.js:54-66).
- `getAllMembers`: gender filter applied (166-176).
- `getMemberById` / `getMemberByGymId`: `scopeResolver.checkMemberScope` (209-211).
- `updateMember`: scope check before mutation (260-262).
- `deleteMember`: scope check + superadmin-only (299-302).
- `renewMember`: scope check (460-461).
- `getExpiringMembers` / `getExpiredMembers`: gender filter (325-336, 354-365).
- `searchMembers`: gender filter (544-555).

**Notable gap:** `getAllMembers` with `?search=` query bypasses the gender
filter (memberController.js:181 — calls `memberRepository.search(search)` with
no genderFilter). **MEDIUM RISK.**

## Frontend registration gender issue

`AdminRegister.jsx` — the standalone register page — has **no gender field**.
It always sends `gender: "Male"` (AdminRegister.jsx:12, 204, 272). The
`RegisterForm.jsx` (used by AdminUpdate and AdminMembers edit modal) does have a
scope-driven gender dropdown (RegisterForm.jsx:197-215). The standalone page is
the primary member registration flow; this means:
- Female_plus_transgender-scoped trainers cannot use the standalone Register
  page (backend rejects Male registration for their scope).
- All members registered via the standalone page are set to Male.

## Registration flow detail (memberController.js:41-152)

1. `ValidationError` for missing fullName/fatherName/phone.
2. Gender scope check against `req.admin.scope`.
3. `gymId = getNextGymId()` (global numeric).
4. `memberCode` from atomic per-gender counter (`Counter.increment`).
5. If paid: compute `currentPaymentDate` + `validityEnd` (plan months, minus 1
   day); status `active`, else `draft`.
6. `memberRepository.create(...)` (with `aadhar`/`phone` digit stripping).
7. If paid: create `FinanceLog` (`type: "new"`) and `PaymentLog`
   (`type: "new"`), then `updateTodaySummary(financeLog)`.
8. Client (AdminRegister.jsx:247) downloads a jsPDF invoice.

**Consistency risk:** steps 6–7 are three independent writes (member, finance,
payment, summary) with no transaction. A failure between them leaves partial
records.

## Member schema / indexes (models/Member.js)

- Unique: `gymId`, `aadhar`, `phone`.
- Enum constraints: `gender` Male/Female/Transgender, `status` active/expired/draft,
  `trainingType` Weight Loss/Weight Gain/Transformation.
- Indexes: dob, gymPlan, createdAt, status + analytics compounds, phone+validityEnd.
- `lastAttendanceDate` (Date, indexed) is updated on each attendance check-in.

## Deletion behavior

- `DELETE /api/members/:gymId` — `requireRole("superadmin")` + scope check.
- Deletes only the Member document (`memberRepository.deleteByGymId`). Related
  Attendance, FinanceLog, PaymentLog records are **not** removed — they remain
  with the numeric `gymId`.
- There is no soft-delete or archived flow in the current code (schema supports
  `status: "draft"` and the constant list includes archived/suspended, but no
  route toggles them).

## Concurrency on registration

- `gymId` generation is NOT atomic (race window under simultaneous registrations
  can produce duplicate `gymId`, caught by the unique index as a 409 duplicate
  key error on the second writer).
- `memberCode` generation IS atomic via the Counter collection.