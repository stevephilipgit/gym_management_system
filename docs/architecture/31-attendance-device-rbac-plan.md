# PHASE 5.5 — DEVICE REQUEST CORRECTION (REVISED PLAN)

> **Status: APPROVAL PENDING — No code written.**

---

## 1. Current Implementation (what exists today)

- `POST /api/admin/devices/activate` — `adminAuth` only, **no `requireRole`**. Any trainer with matching scope can directly activate a DeviceRegistration with a credential. No request/approval.
- `GET /api/admin/devices/compatible-kiosks` — `adminAuth` only. Lists all enabled Kiosks matching the trainer's scope.
- `AttendanceDevices.jsx` — role-unaware, shows "Available Devices" + "Use This Device" to both trainers and Super Admin.
- Sidebar `Attendance Devices` — no `roles` filter, visible to all.
- `DeviceRegistration` — no `requestStatus`/`requestedAt`/`reviewedBy`/`expiresAt`, no lifecycle beyond `active`/`deactivatedAt`/`revokedAt`.

## 2. Current Leakage (confirmed)

| Leak | Root cause |
|---|---|
| Trainer sees global Kiosk inventory | `GET /compatible-kiosks` has `adminAuth` only; sidebar has no role filter |
| Trainer directly activates devices | `POST /activate` has `adminAuth` only; no approval gate |
| Same-scope trainer can activate any same-scope Kiosk | `activateDevice` only checks `kiosk.scope === trainerScope`; no per-trainer authorization |
| No request/approval workflow | The `DeviceRegistration` model has no `requestStatus`; activation is immediate |

---

## 3. Final State Machine

### Two-axis model (single `DeviceRegistration` collection)

| State | `requestStatus` | `active` | `apiKeyHash`/`keyFingerprint` | `claimedAt` | `deactivatedAt` | `revokedAt` | `expiresAt` |
|---|---|---|---|---|---|---|---|
| PENDING | `pending` | `false` | `null` | `null` | `null` | `null` | set |
| APPROVED | `approved` | `false` | `null` | `null` | `null` | `null` | set |
| ACTIVE (claimed) | `approved` | `true` | set | set | `null` | `null` | `null` |
| REJECTED | `rejected` | `false` | `null` | `null` | `null` | `null` | `null` |
| DEACTIVATED | `approved` | `false` | set | set | set | `null` | `null` |
| REVOKED | `approved` | `false` | set | set | `null` | set | `null` |

### Invalid combinations (guarded by service invariants)

| Invalid combination | Why |
|---|---|
| `requestStatus:"rejected"` + `active:true` | Rejected requests cannot be active |
| `requestStatus:"pending"` + `apiKeyHash exists` | Pending requests have no credential |
| `revokedAt exists` + `active:true` | Revoked registrations are inactive |
| `requestStatus:"rejected"` + `claimedAt exists` | Rejected requests cannot be claimed |
| `requestStatus:"approved"` + `apiKeyHash exists` + `active:false` | Approved-but-unclaimed has no credential |
| `expiresAt < now` + `requestStatus:"pending"` | Expired pending cannot be acted upon |
| `expiresAt < now` + `requestStatus:"approved"` + `active:false` | Expired approved cannot be claimed |

### Transitions

```
PENDING  →  APPROVED  (Super Admin)
PENDING  →  REJECTED  (Super Admin)
PENDING  →  [expired] (time passes; expiresAt < now)
APPROVED →  ACTIVE    (trainer claim)
APPROVED →  [expired] (time passes; expiresAt < now; cannot claim)
ACTIVE   →  DEACTIVATED (trainer or Super Admin)
ACTIVE   →  REVOKED   (Super Admin)
DEACTIVATED → ACTIVE  (re-activation if policy permits; re-claim)
```

### Expiration

- `pending` request: `expiresAt` = creation + 7 days (configurable). After expiry, the Super Admin cannot approve it (the route verifies `expiresAt > now`). Frontend shows "Expired". Trainer can submit a new request (no index conflict — the old pending request is expired, and the new one creates a new doc).
- `approved` request: `expiresAt` = approval + 30 days (configurable). After expiry, the trainer cannot claim it. The record remains for audit. Trainer can submit a new request.
- `expired` is NOT a state field — it's derived from `expiresAt < now`. The record remains as-is for audit.

---

## 4. Idempotency Index Design (corrected)

### Problem with the current unconditional unique index

`{kioskId, trainerId, browserDeviceId}` (unique, unconditional) **blocks**:
- Request → rejected → new request (same kiosk+trainer+browser) — E11000
- Active → deactivated → future re-request — E11000

### Corrected indexes

```js
// 1. One LIVE workflow per (kiosk, trainer, browser) — partial unique.
//    Only indexes docs where the request is still actionable (pending or
//    approved but not yet claimed). Historical rejected/expired/active/
//    deactivated/revoked docs are not constrained by this index, so a
//    trainer can re-request after rejection or deactivation.
{
  key: { kioskId: 1, trainerId: 1, browserDeviceId: 1 },
  unique: true,
  partialFilterExpression: { requestStatus: { $in: ["pending", "approved"] } }
}

// 2. One active registration per (kiosk, browser) — partial unique (EXISTING).
//    Unchanged from Phase 1. Guarantees at most one active registration per
//    physical device + browser instance.
{
  key: { kioskId: 1, browserDeviceId: 1 },
  unique: true,
  partialFilterExpression: { active: true }
}

// 3. O(1) credential lookup — unique (EXISTING).
{
  key: { kioskId: 1, keyFingerprint: 1 },
  unique: true
}

// 4. Request listing — new.
{ key: { requestStatus: 1, createdAt: -1 } }

// 5. Trainer's own requests — new.
{ key: { trainerId: 1, requestStatus: 1, createdAt: -1 } }

// 6. Kiosk active queries — existing.
{ key: { kioskId: 1, active: 1 } }

// 7. Trainer active queries — existing.
{ key: { trainerId: 1, active: 1 } }
```

Index #1 is the key fix: it allows historical rejected/expired/deactivated/revoked records while preventing duplicate **live** workflows. "Live" means pending (waiting for approval) or approved (waiting for claim). Once a request is acted upon (rejected, expired, claimed, deactivated, revoked), it falls out of the index and a new live workflow can be created for the same (kiosk, trainer, browser).

---

## 5. Kiosk Binding Security (corrected documentation)

**`kioskId` in browser localStorage is an identifier, NOT authentication.**

A malicious trainer can alter the `kioskId` in localStorage. The security boundary is:

1. **Authenticated trainer session** — `adminAuth` verifies JWT + AdminSession.
2. **Server-side kiosk validation** — the request checks `Kiosk.findOne({kioskId})` exists + enabled + scope matches `req.admin.scope`. A forged kioskId that doesn't exist → 404. A forged kioskId with wrong scope → 403. A forged kioskId matching a different same-scope kiosk → the trainer could request that kiosk instead, but:
3. **Super Admin approval** — required before any credential exists. The trainer cannot self-approve.
4. **Claim authorization** — requires the same authenticated trainer session that owns the request.

**No stronger physical binding is added.** QR/one-time activation codes are unnecessary for this deployment (two fixed gym tablets). The localStorage kioskId is a convenience routing identifier, not a security mechanism. The four-layer security boundary above prevents any authorization bypass.

---

## 6. Trainer Access to Kiosks

**Explicit rule: scope matching IS the authorization.**

Any active trainer whose scope matches a Kiosk may submit a request for that Kiosk. This is intentional — the trainer's scope defines their authorized population. A Male trainer may request any Male Kiosk because they are authorized to operate within the Male population. A Female/T trainer may request any Female/T Kiosk.

No additional per-trainer → per-Kiosk authorization mechanism is needed. If future business rules require explicit trainer-to-Kiosk assignment, that is a separate feature.

---

## 7. Multiple Trainers Using One Physical Kiosk

Trainer A (morning) and Trainer B (evening) use the same physical Kiosk:

- Each trainer submits their own request (different `trainerId`; same `kioskId`).
- Each request is independently approved and claimed.
- **Transfer semantics** (same browser): if Trainer B activates the same browser Trainer A was using, the server atomically deactivates A's registration and activates B's (in a transaction, with net-delta cap accounting). Exactly one active registration per `(kiosk, browser)` at all times, guaranteed by the partial unique index `{kioskId, browserDeviceId}` where `active:true`.
- If Trainer A and B use different browsers (e.g., A on their laptop, B on the tablet), both can be active simultaneously for the same physical Kiosk — each is an independent browser instance.

---

## 8. Same Browser / Same Trainer Duplicate Request

**Partial unique index #1** (`{kioskId, trainerId, browserDeviceId}` where `requestStatus` in `["pending", "approved"]`) prevents duplicate live workflows:

- Trainer clicks "Request This Device" → creates pending request.
- Trainer clicks again → existing pending request is returned (idempotent via the unique index — E11000 caught and the existing doc is returned).
- If the previous request was rejected → the old doc has `requestStatus:"rejected"` → not in the partial index → a new pending request can be created.
- If the previous request was approved → the old doc has `requestStatus:"approved"` → still in the partial index → duplicate blocked → existing approved request returned.
- If the previous request was claimed → active → `requestStatus:"approved"` but also `active:true` → still in the partial index → blocked. But the trainer already has an active registration; they should see "Active" not "Request New Device". The frontend handles this.

---

## 9. Active Registration Cap

**Two separate caps:**

| Cap | Hard/Soft | Enforced | Value | Configurable |
|---|---|---|---|---|
| Kiosk max active registrations | **Hard** | `findOneAndUpdate({_id, activeRegistrationCount: {$lt: MAX}})`, atomic slot reservation | 5 (default) | `MAX_REGISTRATIONS_PER_KIOSK` env |
| Trainer active device warning | **Soft** | Frontend warning + notification; Super Admin decides | 2 | `TRAINER_MAX_ACTIVE_WARNING` env |

**If claim occurs after Kiosk capacity is exhausted:**
- The `claimDevice` service performs the same atomic slot reservation as `activateDevice` (`findOneAndUpdate({_id, activeRegistrationCount: {$lt: MAX}})`, `{$inc: 1}`).
- If capacity is full → **claim fails safely** with `409 "Device registration capacity reached. Contact the gym administrator."`.
- The request remains `approved`/unclaimed. The trainer can retry later (while the approval is still valid, before `expiresAt`).
- Super Admin can deactivate/revoke an existing registration to free a slot, then the trainer can retry the claim.

---

## 10. Active Registration Counter

`Kiosk.activeRegistrationCount` counts only `active:true` registrations. The existing counter invariant test (Phase 3 carry-over #5) already proves the counter stays consistent across the full lifecycle. It will be extended to cover the new request/claim/approve/reject paths.

The counter is **not** incremented/decremented for:
- `pending` or `approved` (unclaimed) requests — no credential, no active record.
- `rejected` requests — never active.
- `deactivated` or `revoked` registrations — was active, now decremented.

---

## 11. Credential Model (unchanged, already correct)

```
Super Admin APPROVE → sets requestStatus:"approved" → NO credential.
Trainer CLAIM → generate 256-bit random key → sha256(64 hex) fingerprint → bcrypt hash → store hash + fingerprint → active:true → return plaintext ONCE.
Rotation → new key, new hash + fingerprint, old key invalidated. Return plaintext once.
Never: store plaintext, put in notification, put in URL, show on approval screen.
```

---

## 12. Notification Is Not the Source of Truth

Notification is a convenience. The trainer must be able to query `GET /api/admin/devices/my/requests` to discover approved/claimable requests regardless of notification delivery. The claim endpoint is always accessible through the authenticated API.

---

## 13. Device Disable / Registration Revoke

| Action | Effect | Scope |
|---|---|---|
| `Kiosk.enabled = false` | Every registration under that Kiosk fails-closed (kioskAuth checks `Kiosk.enabled`). No individual doc mutation. | Global per Kiosk |
| `Registration.revoke()` | Single registration: `active=false, revokedAt=set`. Other registrations on the same Kiosk unaffected. | Per registration |
| `Registration.deactivate()` | Single registration: `active=false, deactivatedAt=set`. Can be re-activated. | Per registration |

No destructive delete for routine security actions.

---

## 14. Scope Reassignment

Already defined: transaction changes `Kiosk.scope` + stamps `scopeChangedAt` + revokes all existing registrations (`updateMany({kioskId}, {active:false, revokedAt})`). The `scopeChangedAt` defense-in-depth in kioskAuth rejects any registration whose `activatedAt` predates the change. No old registration can punch after reassignment.

---

## 15. Trainer Disable — BUSINESS DECISION

**Question:** If a trainer account is disabled, should their active DeviceRegistrations immediately become unusable?

**Recommended:** YES — the trainer's authorization is invalidated. Their registrations are revoked (set `active:false, revokedAt`). The physical Kiosk remains (other trainers' registrations on the same Kiosk are unaffected). This prevents an unauthorized trainer from continuing to operate an attendance device.

**If the business rule is different (e.g., "devices continue operating, Super Admin must explicitly revoke"), state now.** This affects the implementation of `adminController.updateAdmin` (disable trainer → cascade revoke registrations).

---

## 16. Trainer Scope Change — BUSINESS DECISION

**Question:** If a trainer changes scope (e.g., Male → Female/T), should their existing active DeviceRegistrations under the old scope be revoked?

**Recommended:** YES — the trainer's existing registrations were authorized under the old scope. A Male-scope trainer should not continue operating a Male device after becoming Female-scope, because they are no longer authorized for the Male population. Revoke existing registrations; the trainer can submit new requests under the new scope.

**If the business rule is different (e.g., "existing registrations continue, only new requests use new scope"), state now.**

---

## 17. Route Security (final)

Mounted at `/api/admin/devices`. All behind `adminAuth`.

**Trainer:**

| Method | Path | Guard | Controller |
|---|---|---|---|
| POST | `/request` | `adminAuth` | `requestDevice` |
| GET | `/my` | `adminAuth` (filtered by `req.admin.id`) | `listMyDevices` |
| GET | `/my/requests` | `adminAuth` (filtered by `req.admin.id`) | `listMyRequests` |
| POST | `/requests/:requestId/claim` | `adminAuth` + ownership check | `claimDevice` |
| POST | `/:registrationId/deactivate` | `adminAuth` + ownership check | `deactivate` |

**Super Admin:**

| Method | Path | Guard | Controller |
|---|---|---|---|
| GET | `/` | `adminAuth` + `requireRole("superadmin")` | `listAllDevices` |
| GET | `/requests` | `adminAuth` + `requireRole("superadmin")` | `listAllRequests` |
| POST | `/requests/:requestId/approve` | `adminAuth` + `requireRole("superadmin")` | `approveRequest` |
| POST | `/requests/:requestId/reject` | `adminAuth` + `requireRole("superadmin")` | `rejectRequest` |
| POST | `/:registrationId/revoke` | `adminAuth` + `requireRole("superadmin")` | `revoke` |
| POST | `/:registrationId/rotate` | `adminAuth` + `requireRole("superadmin")` | `rotate` |
| POST | `/kiosks/:kioskId/reassign-scope` | `adminAuth` + `requireRole("superadmin")` | `reassignScope` |

**Removed:**

| Method | Path | Reason |
|---|---|---|
| POST | `/activate` | Trainer direct activation — removed |
| GET | `/compatible-kiosks` | Trainer must not see global Kiosk inventory |

---

## 18. Frontend Role Separation

**TRAINER UI:**
```
My Attendance Devices
  Active:
    Device label · Active · [Deactivate]
  Pending:
    Device label · Awaiting approval
  Approved:
    Device label · Approved · [Claim]
  Rejected:
    Device label · Rejected (reason)
  [Request New Device] → form (reads kioskId from browser, shows device label)
```

**SUPER ADMIN UI:**
```
Device Requests
  Pending (tab):
    Trainer A · Male Tablet 01 · 2026-08-30 · [Approve] [Reject]
  Approved (tab):
    Trainer A · Male Tablet 01 · claimed ✓
  Rejected (tab):
    Trainer B · Female Tablet 01 · "limit reached" · [Re-activate]

All Attendance Devices
  male-tablet-01 · Male · Active · 2 registrations · [Revoke] [Rotate]
  female-tablet-01 · Female/T · Active · 1 registration · [Revoke] [Rotate] [Reassign Scope]
```

**CUSTOMER:** attendance page only (unchanged).

---

## 19. Super Admin Approval Details

Request table shows: trainer name, username, role, scope, kiosk name/id, kiosk scope, browser/device label, requestedAt, current trainer active registration count, request status. Never shows: raw API key, password, token, secret.

---

## 20. Audit Events

Using existing `auditLog` infrastructure. Events: device request created, request approved, request rejected, device claimed, registration deactivated, registration revoked, credential rotated, kiosk disabled, kiosk scope reassigned. Each records: actor, trainer, kiosk, registration/request, timestamp, outcome. Never log raw credentials.

---

## 21. Pagination / Bounded Lists

Super Admin endpoints (`GET /requests`, `GET /`) support:
- `?status=pending&skip=0&limit=50`
- Indexed sort by `createdAt`
- Maximum limit enforced (e.g., 100)

Trainer endpoints (`GET /my`, `GET /my/requests`) are bounded by `trainerId` index (max ~a few dozen per trainer). No pagination needed for trainer's own lists, but a `limit` parameter is supported for safety.

---

## 22. Rate Limiting / Failed-ID Poisoning

The current `kioskFailedIdLimiter` keys on `IP:input`. An attacker who knows a valid Gym ID can exhaust that ID's failed-attempt budget for 60 seconds, blocking that member from punching. **Mitigation:**
- The per-IP limiter (60/min) also bounds the attacker.
- The per-device limiter (120/min) bounds the attacker from a single device.
- The failed-ID limiter's 20 distinct IDs per minute is per-IP, so the attacker can only target 20 IDs per minute.
- **Recommendation:** keep the current limiter design. The 60-second window is short, and the attacker must know the victim's Gym ID (which is a numeric identifier, not a secret). Document the risk.

---

## 23. Public Customer API (unchanged)

`POST /api/attendance/kiosk/punch { input }` — no `scope`, `gender`, `memberId`, `trainerId`, arbitrary filters. The authenticated DeviceRegistration (via `kioskAuth`) determines the Kiosk and scope. Then Gym ID → scoped Member query → exact `Member._id` → fresh eligibility → atomic attendance.

---

## 24. Attendance Identity (unchanged)

`Attendance.memberId = Member._id`. Never Gym ID. Male 192 and Female 192 are independent.

---

## 25. Female / Transgender Integrity (unchanged)

Female + Transgender share `gym_id_F`. No `gym_id_T` as active counter. Same-number Female+Transgender → `integrity_error`, no attendance, no arbitrary selection.

---

## 26. HTTP End-to-End Test

A real HTTP staging test must be written and executed before Phase 5.5E is declared complete. The test covers:
1. Trainer login (POST /api/admin/login)
2. Create request (POST /api/admin/devices/request)
3. Super Admin login
4. Approve (POST /api/admin/devices/requests/:id/approve)
5. Trainer claim (POST /api/admin/devices/requests/:id/claim)
6. Customer punch (POST /api/attendance/kiosk/punch)
7. Verify MongoDB Attendance record

---

## 27. Critical Acceptance Scenarios

All 20 scenarios (A–T) are mapped to specific tests in the test matrix. Each asserts specific HTTP status, attendance invariance, and no cross-scope leakage.

---

## 28. Failure / Outage Behavior

- MongoDB unavailable → request fails, no false "approved" or "active".
- Credential generation fails → claim fails, no partial state.
- Notification fails → request remains approved; trainer queries `/my/requests`.
- Transaction failure → rollback, no inconsistent state.
- Counter drift → invariant test detects before next claim.

---

## 29. No Offline Attendance (unchanged)

No queue. Server unavailable → customer is not marked present.

---

## 30. Stale Code Audit (deferred to Phase 5.5F)

| Item | Code path | Runtime refs | Tests | Decision |
|---|---|---|---|---|
| `KioskSetup.jsx` + `/kiosk-setup` | Frontend route + page | None (unlinked from customer page) | None | REMOVE |
| `POST /activate` | `deviceController.activate` + `deviceRoutes` | `deviceLifecycle.test.js` | Remove after Phase 5.5E | REMOVE |
| `GET /compatible-kiosks` | `deviceController.listCompatibleKiosks` + `deviceRoutes` | `kioskScopedPunch.test.js` | Verify no test depends on it | REMOVE |
| `activateDevice` service | `deviceRegistrationService.activateDevice` | `deviceLifecycle.test.js` (concurrent, cap, transfer, idempotent) | Replace with request/claim/approve | REMOVE or restrict to superadmin |
| Old picker/token/memberCode paths | `kioskService.js` | `kiosk.test.js` (SELECT, RESOLVE ambiguous) | Keep legacy tests; mark as deprecated | KEEP (legacy no-scope path) |
| `Kiosk.apiKeyHash` | Kiosk model, `kioskAdminController.js` | `kiosk.test.js` (legacy-credential-rejected test) | Test proves it's rejected | REMOVE (already unused by kioskAuth) |
| `gym_id_T` counter | `counters` collection | `preflight-member-identity.mjs` | None | REMOVE (data cleanup) |

---

## 31. Implementation Phases

**PHASE 5.5A — Model + indexes + request lifecycle**
- Add fields to `DeviceRegistration`: `requestStatus`, `requestedAt`, `reviewedBy`, `reviewedAt`, `rejectionReason`, `claimedAt`, `expiresAt`
- Make `apiKeyHash`/`keyFingerprint` optional (nullable)
- Replace unconditional unique `{kioskId, trainerId, browserDeviceId}` with partial unique on `requestStatus: {$in: ["pending", "approved"]}`
- Add new indexes: `{requestStatus, createdAt}`, `{trainerId, requestStatus, createdAt}`
- Add `DeviceRegistration` schema validation (invalid state combinations)
- Add `Kiosk.activeRegistrationCount` maintenance for `requestStatus:"approved"` + `active:true`
- Run model/index tests + invariant tests. **STOP.**

**PHASE 5.5B — Trainer request endpoints + Super Admin approval**
- `deviceRegistrationService.requestDevice` — validate kiosk exists+enabled+scope match, create pending request
- `deviceRegistrationService.approveRequest` — set `requestStatus:"approved"`, `reviewedBy`, `reviewedAt`, `expiresAt`
- `deviceRegistrationService.rejectRequest` — set `requestStatus:"rejected"`, `rejectionReason`
- `deviceController.requestDevice`, `approveRequest`, `rejectRequest`, `listMyRequests`, `listAllRequests`
- `deviceRoutes` — add new routes, remove `/activate` and `/compatible-kiosks`
- Tests: request creation, approval, rejection, idempotency, scope match, scope mismatch, expired approval, concurrent request. **STOP.**

**PHASE 5.5C — Credential claim + lifecycle**
- `deviceRegistrationService.claimDevice` — revalidate trainer+kiosk at claim time, generate credential, atomic activation
- `deviceController.claimDevice`, `listMyDevices`, `listAllDevices`
- Claim tests: concurrent claim, re-validation at claim time (trainer disabled, scope changed, kiosk disabled, request expired, already claimed), credential once, punch works after claim. **STOP.**

**PHASE 5.5D — Frontend separation**
- `AttendanceDevices.jsx` rewrite: trainer UI (request/claim/deactivate) + Super Admin UI (approve/reject/manage)
- `AdminSidebar.jsx` — role-conditional or separate "Device Requests" nav
- `AdminHeader.jsx` — notification for approved requests
- Frontend build + lint. **STOP.**

**PHASE 5.5E — HTTP integration + security tests**
- Full HTTP end-to-end test (§26)
- All 20 acceptance scenarios (§27)
- All 20 security tests (forged kioskId, trainerId, scope, cross-trainer claim, etc.)
- Full backend suite + frontend build. **STOP.**

**PHASE 5.5F — Final stale-code cleanup**
- Remove `KioskSetup.jsx`, `/kiosk-setup`, `POST /activate`, `GET /compatible-kiosks`, `activateDevice` service, `Kiosk.apiKeyHash`, `gym_id_T` counter
- Deprecate obsolete docs. **STOP.**

---

## 32. Exact Files to Modify

**Backend modify:**
- `models/DeviceRegistration.js` — add fields, fix indexes
- `routes/deviceRoutes.js` — new routes, remove old
- `controllers/deviceController.js` — new controllers, remove old
- `services/deviceRegistrationService.js` — new services, remove `activateDevice`
- `utils/dbIndexes.js` — update indexes
- `core/constants.js` — add device lifecycle action types

**Backend new:** None (single collection).

**Frontend modify:**
- `admin/AttendanceDevices.jsx` — rewrite
- `admin/AdminSidebar.jsx` — role-conditional device nav

**Frontend remove later (Phase 5.5F):**
- `pages/KioskSetup.jsx`

---

## 33. Exact Files to Remove Later (Phase 5.5F)

- `pages/KioskSetup.jsx` + `/kiosk-setup` route in `App.jsx`
- `POST /activate` + `GET /compatible-kiosks` route/handler code
- `Kiosk.apiKeyHash` field (model + kioskAdminController)
- `gym_id_T` counter data (separate migration)

---

## 34. Remaining Risks

1. **Failed-ID poisoning risk** — documented, accepted (60s DoS on known Gym ID).
2. **Two business decisions pending** — trainer disable cascading to registrations, and trainer scope change cascading to registrations (§15, §16). Must be answered before Phase 5.5B.
3. **Expiration TTL values** — pending (7 days) and approved (30 days) are defaults; confirm or adjust.
4. **Grandfathered registrations** — none exist; the only artifact (`kiosk-test-01`, scope-null) will be disabled.
5. **Single collection vs separate DeviceRequest** — the plan uses a single collection with two-axis state model. If request audit retention must outlive registration deletion, separate collections would be needed. Since no destructive delete occurs, the single collection preserves audit.

---

## 35. Open Questions

1. **Trainer disable:** Should disabling a trainer revoke their active DeviceRegistrations? (Recommended: YES.)
2. **Trainer scope change:** Should changing a trainer's scope revoke their existing active registrations under the old scope? (Recommended: YES.)
3. **Expiration TTL:** Confirm pending TTL (7 days) and approved TTL (30 days) defaults.
4. **`kiosk-test-01`:** Confirm it can be disabled/deleted (no scope, no registration, no customers).

---

## STOP GATE

No code written. No migrations created. No files deleted. Awaiting your answers to the 4 open questions and explicit approval before Phase 5.5A.