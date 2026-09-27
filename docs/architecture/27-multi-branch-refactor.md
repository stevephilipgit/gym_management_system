# Multi-Branch Refactor — Design Spec

Status: APPROVED (plan v3) · Scope: backend only · Date: 2026-09-27

## 1. Goal

Introduce `branchId` data partitioning across nine collections, branch-bound
admins, a trainer `DELETE` guard, composite branch-scoped indexes, and
per-branch financial reconciliation — while preserving `gymId` as the member's
keypad/serial number everywhere (bills, kiosks, PDFs, public lookup).

## 2. Contracts

### 2.1 Branch model (`backend/src/models/Branch.js`)

| Field | Type | Constraint |
|---|---|---|
| `name` | String | required |
| `code` | String | required, unique, uppercase on write |
| `isActive` | Boolean | default `true` |
| `timestamps` | — | createdAt/updatedAt |

Default branch: `{ name: "Mathur Branch", code: "MATHUR", isActive: true }`.

### 2.2 `branchId` field (9 models)

```js
branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true }
```

Models: `Member`, `FinanceLog`, `PaymentLog`, `DailySummary`, `Attendance`,
`Package`, `Enquiry`, `Kiosk`, `Admin`.

**Implication:** every `create`/`insertMany` for these models must supply a
`branchId`. Production write sites are stamped from `req.branchId` (admin
principal), `req.kiosk.branchId` (kiosk principal), or the default branch for
public flows (enquiry form). Test fixtures seed a branch and stamp it.

### 2.3 Composite indexes

| Collection | Index | Uniqueness |
|---|---|---|
| `members` | `{ branchId, gender, gymId }` | unique (keypad resolution) |
| `members` | `{ branchId, phone }` | unique (was global `phone`) |
| `dailysummaries` | `{ branchId, date }` | unique (was `date` alone) |
| `kiosks` | `{ branchId, kioskId }` | unique (was `kioskId` alone) |

Declared in **four** places that must stay in sync: schema definitions,
`src/utils/dbIndexes.js`, `scripts/createIndexes.js`, `src/seed.js`.
The migration script drops the superseded indexes (`idx_members_gym_gender_unique`,
`phone_1` unique, `date_1` unique on dailysummaries, `kioskId_1` unique).

**Not changed:** `memberCode` unique (global counters stay `member_code_M/F`),
`aadhar` unique, `Admin.username/email` unique, `{memberId,date}` attendance unique.

### 2.4 Auth & context

- JWT access token payload gains `branchId` (`authController.issueTokens`).
- `adminAuth` adds `branchId` to its DB projection and attaches
  `req.admin.branchId` (DB is authoritative; JWT claim is informational).
- New `src/middleware/branchContext.js`, invoked from `adminAuth`'s tail:
  - `req.branchId = req.admin.branchId` (403 `{ success:false, message:"Forbidden: No branch context." }` when absent for an authenticated admin);
  - **Trainer delete guard:** `req.method === "DELETE" && req.admin.role === "trainer"` → `403 { success:false, message:"Forbidden: Trainers cannot delete records." }`;
  - no-op when `req.admin` is absent (public/kiosk routes).
- `kioskAuth` attaches `req.kiosk.branchId` (server-derived from the Kiosk doc);
  `adminAttendanceAuth` attaches `req.attendancePrincipal.branchId`.

### 2.5 Scope resolver

`buildGenderFilter(req)` returns `{ branchId?, gender?: { $in: [...] } }`:
branch partition always included when `req.branchId` exists; gender constraint
unchanged. `getScopedMemberIds` also constrains `branchId`.
New `buildBranchFilter(req)` → `{ branchId: req.branchId }` (throws/403 upstream
if missing) for non-gender collections (FinanceLog, PaymentLog, DailySummary,
Attendance, Admin, Kiosk, Enquiry, Package).

### 2.6 Public validity lookup

Both aliases (`GET /api/members/public-validity/:gymId`,
`GET /api/public/check-member`) share `memberController.checkPublicValidity`:

- Branch source: `x-branch-id` header (validated 24-hex; invalid ⇒ absent) or
  `?branchId=`.
- gymId path: branch present ⇒ `{ branchId, gymId }`; branch absent ⇒ `{ gymId }`.
- Phone path: branch present ⇒ `{ branchId, phone }`; branch absent ⇒ `{ phone }`.
- Multiple matches ⇒ HTTP 200 body:
  ```json
  { "success": true, "data": { "found": false, "status": "ambiguous",
    "message": "Multiple members found across branches." } }
  ```
  (`found:false` preserved for existing frontend widgets; `status` per spec.)
- Single match ⇒ unchanged payload; `gymId` is always the bare keypad number.
- Zero matches ⇒ unchanged `{ found:false, message:"No membership found" }`.

### 2.7 Summary service (per-branch)

- `rebuildSummaryForDate(targetDate, branchId)` — `branchId` **required**
  (throws when missing): FinanceLog window filtered by branch, member aggregate
  `$match` includes branch, upsert keyed `{ date, branchId }`.
- `rebuildTodaySummary(targetDate, branchId)` → delegates.
- `getTodaySummary(session, branchId)` / `updateTodaySummary(txLog, session)` —
  branch derived from `txLog.branchId` (stamped at write sites).
- `markPreviousDayComplete(branchId?)` — `updateMany`, all branches when omitted.
- `reconcileDailySummaries(opts)` — outer loop `Branch.find({ isActive: true })`,
  inner day loop; `details[]` entries gain `branchId`/`branchCode`;
  `report.branchesProcessed`; per-branch error isolation. If **no** active branch
  exists, reports `processedDays: 0` (idempotent no-op).
- `initDailyTasks` midnight task iterates active branches.
- Cron wiring unchanged (`CRON_CONFIG`); `executeFinanceReconciliation` logs
  `branchesProcessed`.
- `analyticsService.getAnalyticsMetrics(start, end, branchId)` adds `branchId`
  to the shared `$match` filter (omitted when `null`/undefined).

### 2.8 Keypad (gymId) generation

`getNextGymId(gender, branchId, branchCode)` → counter key
`gym_id_${branchCode}_${M|F}`, seeded from the per-branch max. Import reseed
path uses per-branch keys. `memberCode` counters remain global.

## 3. Edge cases

1. **No active branch at reconcile time** → zero-branch no-op report, logged.
2. **Legacy token without `branchId` claim** → adminAuth DB projection still
   supplies `req.admin.branchId`; no forced re-login.
3. **Admin document without `branchId` (pre-migration)** → `branchContext`
   returns 403 with an explicit message; migration backfills to MATHUR.
4. **Invalid/absent `x-branch-id`** → treated as absent ⇒ cross-branch lookup
   with ambiguity protection (never silently picks one).
5. **Same gymId in two branches** → allowed by `{branchId,gender,gymId}` unique;
   keypad displays remain bare numbers, branch disambiguates.
6. **Same phone in two branches** → allowed by `{branchId,phone}` unique;
   public/kiosk phone lookups return ambiguity instead of `findOne`.
7. **Public enquiry (no admin)** → branch resolved via `preferred_branch`
   mapping (Mathur→MATHUR, Vepery→VEPERY if present), fallback = first active
   branch.
8. **Trainer hits DELETE on any admin route** → 403 from `branchContext` even
   where `requireRole` is not chained.

## 4. Breaking risks & mitigations

| Risk | Mitigation |
|---|---|
| Required `branchId` rejects legacy writes | Migration backfills all 9 collections before deploy; scripts (`seed`, `create-admin`, `create-kiosk`) create/lookup default branch first |
| Old unique indexes conflict with new data | Migration drops old indexes before creating new ones; duplicate-key errors surface with collection+key in the log |
| Test fixtures lack `branchId` | Shared helper `tests/utils/branchFixture.js`; every fixture stamps `branchId` |
| Reconcile with `branchId` omitted silently aggregates all branches | Explicit `Error` thrown — no silent cross-branch rollup |
| Frontend doesn't send `X-Branch-Id` yet | Cross-branch lookup + ambiguity response keeps behavior correct (documented follow-up) |
| `gym_id_M` legacy counters reused for new branch | New per-branch keys seeded from that branch's max; legacy keys untouched |

## 5. Verification plan

- `npm test` (mocha, mongodb-memory-server): all existing suites updated with
  branch fixtures + new suite `multiBranch.test.js` covering: branch filter
  isolation, trainer DELETE 403, compound uniqueness (gymId × branch, phone ×
  branch), public lookup ambiguity payloads (both aliases), per-branch
  reconciliation over two branches, `branchContext` 403 on missing branch.
- Grep audit: every query on the 9 collections carries `branchId` /
  `buildBranchFilter` / `buildGenderFilter`.
- Migration script dry-run against a copy: index drops/creates verified.

## 6. Implementation status (completed 2026-09-27)

**Status: IMPLEMENTED · MIGRATED · REGRESSION GREEN**

### 6.1 Test results

- Baseline before refactor: `226 passing / 229 pending / 0 failing`.
- Final: `242 passing / 229 pending / 0 failing` (226 baseline + 16 new
  `multiBranch.test.js` cases).
- The 229 pending are pre-existing integration suites that skip when no local
  `localhost:27017` exists (unchanged from baseline); their fixtures were
  still updated so they run green in DB-equipped environments.

### 6.2 Migration executed against production (`DATABASE_URL`, Atlas `giri_gym`)

```
Branch: Mathur Branch (MATHUR) -> 6ab90cdbdb4d85d047f9b59a
backfilled: Member 24, Admin 4, Package 6, Kiosk 4, Enquiry 2,
            DailySummary 12, Attendance 5, FinanceLog 21, PaymentLog 21
duplicates: {} (none)
dropped: idx_members_gym_gender_unique, phone_1, date_1, kioskId_1
created:  idx_members_branch_gender_gym_unique, idx_members_branch_phone_unique,
          idx_dailysummary_branch_date_unique, idx_kiosks_branch_kiosk_unique
counters: gym_id_MATHUR_M=5983, gym_id_MATHUR_F=4200
errors: []
```

Post-migration check: `adminsMissingBranchId = 0` (4/4) — the
`branchContext` 403 that blocked pre-migration logins is cleared.

### 6.3 Source gaps found and fixed during the test phase

- `deviceActivationService.js` — `redeemActivation` auto-creates a `Kiosk`
  document (Case A); now stamps `branchId: trainer.branchId`, and the trainer
  projection gained `branchId` (previously `role scope status passwordHash`
  only). Not reachable until the activation flow test ran against a replica set.

### 6.4 Grep audit verdict (9 collections, production code)

Scoped/stamped: ✅ controllers (member, payment, attendance, kiosk,
kioskAdmin, package, reports, enquiry, auth, analytics, deviceActivation),
repositories (member, payment, package), services (attendance, kiosk, summary,
analytics, attendanceExport requester-side), jobs, scripts.

Deliberately global (by design): Admin username/email (login + reset),
`memberCode` counters + prefix scans, `clientRequestId` idempotency,
`kioskAuth` kioskId ambiguity guard, public unscoped ambiguity handling,
reconciliation branch iteration, attendance auto-close job.

Dead code (unscoped but **zero callers** — no exposure, candidates for
deletion): `middleware/attendanceValidation.js:detectInputTypeAndFetchMember`,
`memberRepository.findByStatus`, `memberRepository.findByPackage`.

### 6.5 Known follow-ups (outside approved spec — NOT implemented)

1. **AI tools (`services/ai/tools.js`)** — filtered by gender `scope` only;
   `chatService` does not pass `branchId`. A branch-A trainer using AI chat
   could count/see branch-B members. Needs `branchId` threaded through the
   tool context.
2. **Daily attendance export (`attendanceExportService.generateFile`)** — one
   global CSV per date (`attendance-<date>.csv`, no branch in filename);
   spec was silent. Harmless while one branch is active; needs a per-branch
   design if a second branch goes live.
3. **Device listing for superadmin** (`deviceActivationController.
   listAllRegistrations`) — `DeviceRegistration` is not one of the 9
   branch-stamped models; superadmin sees all trainers' devices.
