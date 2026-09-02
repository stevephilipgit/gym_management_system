# Phase 4 — Security + Concurrency Audit Results

Status: COMPLETE · Verified 2026-09-02 · Branch: `attendance-feat`

## Purpose / Scope

Phase 4 validates that the implemented device-attendance system cannot be
bypassed, corrupted by race conditions, or weakened through malicious input.
It exercises the real backend services and middleware against a live MongoDB
(Atlas), not just code inspection.

The scope is limited to security and concurrency of the Trainer device
activation flow and the Super Admin scoped-attendance flow. UI polish is
explicitly deferred and out of scope.

## Test Command

```bash
cd backend
MONGO_URI="<atlas test db>" npx mocha "src/tests/phase4Security.test.js" --timeout 120000
```

## Results

| Measure | Result |
|---|---|
| Phase 4 security tests | **48 passing, 0 failing** |
| Full backend regression | **201 passing, 0 failing** |
| Frontend build | **PASS** (1355 modules, ~11s) |
| Frontend automated tests | NOT APPLICABLE (no harness in project) |

## Security Test Categories (all executed against live MongoDB)

### 1. Authorization / IDOR (7 tests)
- A Trainer cannot redeem another Trainer's activation (401).
- Forged/nested browserDeviceId rejected (400).
- Malformed browserDeviceId (`$ne`, `$gt`, `$in`, `$regex`, `<svg>`, newline) rejected (400).
- Forged trainerId in generation rejected (404).
- Trainer cannot deactivate another Trainer's registration (403).
- Scope is server-derived, never client-supplied.
- Cannot generate an activation for a non-Trainer target (404).

### 2. Trainer Activation Security (6 tests)
- Valid code redeems exactly once; replay → 409 "already been used".
- Wrong password → 401, no state change.
- Expired activation → 401, no state change.
- Revoked activation → 401.
- QR redemption consumes activation; 6-digit code becomes invalid.
- QR + code race → exactly one winner, single-use lifecycle.

### 3. Brute-Force / Rate Limiting (2 tests)
- Repeated wrong codes → identical generic 401 (no enumeration).
- Valid code after failed attempts still works (no permanent code lockout).
- Dedicated redeem limiter wired (5/min per IP+Trainer) — CODE-REVIEW for
  route-level 429 (covered below under limitations).

### 4. Device Ownership Invariants (3 tests)
- INVARIANT B: same browser, two Trainers → 409, no ownership transfer.
- INVARIANT A: one active device per Trainer (replacement).
- Simultaneous replacement → exactly one active device, valid final state.

### 5. Kiosk State (4 tests)
- Absent Kiosk → created with activation scope, enabled=true.
- Existing enabled matching Kiosk → reused, never re-scoped.
- Disabled Kiosk → activation rejected, Kiosk NOT re-enabled.
- Scope-mismatch Kiosk → activation rejected, scope NEVER overwritten.

### 6. Trainer Scope Change (1 test)
- Scope change revokes active registration + unused activations; fresh
  activation under the new scope required.

### 7. Super Admin Attendance Token Security (10 tests)
- Valid token → principal attached (superadmin).
- Forged/random token → 401.
- Expired token → 401.
- Scope "all" → 401.
- Wrong audience → 401.
- Wrong issuer → 401.
- Missing purpose → 401.
- Normal login JWT cannot be used as an attendance token → 401.
- Non-superadmin with valid-purpose token → 403 (DB role re-check).
- Wrong algorithm (HS384) → 401.

### 8. Stale Browser State (1 test)
- Super Admin precedence is a frontend rule; backend has no stale-credential
  fallback (CODE-REVIEW).

### 9. Bearer Credential (1 test)
- Old credential invalid after replacement; revoked credential cannot be
  looked up by fingerprint.

### 10. Input Validation / NoSQL (3 tests)
- Generation rejects non-string / `$gt` / `$in` / array / number / null trainerId.
- Redemption response contains no hashes/keys/secrets/plaintext code.
- Generation response contains no hashes; code is 6 digits.

### 11. Active Registration Count (1 test)
- Counter is informational; equals actual active registrations; same-Kiosk
  replacement keeps count consistent; never negative.

### 12. Revocation → Reactivation Lifecycle (7 tests, REACT-A..G)
- **REACT-A**: Trainer A active → Admin revoke → new activation → same Browser
  X → SUCCESS (new registration created, old remains historical).
- **REACT-B**: A revoked → Trainer B takes over browser → follows ownership rule.
- **REACT-C**: A active → B attempts → 409 ownership conflict.
- **REACT-D**: disabled Kiosk → rejected, stays disabled.
- **REACT-E**: same-scope enabled Kiosk → reused successfully.
- **REACT-F**: scope mismatch → rejected, scope unchanged.
- **REACT-G**: 3 revoke/reactivate cycles; historical records coexist; partial
  unique index applies only to active registrations.

### 13. Super Admin Attendance Data Isolation (2 tests)
- Male + Female same Gym ID resolve scope-specifically; each writes its own
  Attendance record.
- Female + Transgender same Gym ID → integrity_error, NO Attendance write.

## Reactivation Lifecycle Bug — Verified Resolution

**Reported symptom**: same-Trainer revoke → reactivate on the same browser
returned "Attendance device ownership conflict".

**Root cause analysis**: the ownership check in `redeemActivation` filters on
`active: true AND trainerId != authenticated trainer`. A revoked/inactive
registration of the SAME trainer is excluded by design.

**Verified resolution**: reproduced the exact scenario end-to-end
(activate → revoke → reactivate same browser) and it **succeeds**. Seven
regression tests (REACT-A..G) enforce this behaviour. No service code change
was required for the fix — it was already correct; the tests were added to
lock the invariant.

## Transaction / Atomicity Result

The device switch (activation consume → old registration deactivate →
new registration create → Kiosk resolve → counter update) runs inside a Mongo
`session.withTransaction`. Verified:
- Replay of a consumed activation → deterministic 409, never a second device.
- Simultaneous replacement → valid final state with exactly one active device.
- Concurrent QR + code → exactly one winner.
- Standalone Mongo (transactions unavailable) → **BLOCKED** (503); no
  non-atomic fallback is executed. Production Atlas is a replica set and uses
  the transaction path.

## Full Regression Evidence

```bash
cd backend
MONGO_URI="<atlas test db>" npx mocha src/tests/deviceRegistration.test.js \
  src/tests/deviceLifecycle.test.js src/tests/kiosk.test.js \
  src/tests/kioskScopedPunch.test.js src/tests/securityAndConcurrency.test.js \
  src/tests/scopeAndSessions.test.js src/tests/reportsRbac.test.js \
  src/tests/phase4Security.test.js --timeout 60000
# → 201 passing, 0 failing
```

## Limitations / Deferred Items

1. **Route-level 429 on the redeem limiter** — the dedicated rate limiter
   (5/min per IP+Trainer) is wired on the route; the middleware-level 429
   behaviour is CODE-REVIEW (service-level generic-failure behaviour is
   EXECUTED + PASS).
2. **Stale-browser precedence** — verified by code inspection; the actual
   browser path is exercised in Phase 5 E2E.
3. **Frontend automated tests** — NOT APPLICABLE (no harness).
4. **Real 3-profile browser E2E** — deferred to Phase 5.
5. **Phase 6 cleanup** (legacy provisioning references, docs) — deferred.

## Phase 4 Conclusion

The implemented device-attendance system satisfies the Phase 4 security and
concurrency requirements: no IDOR, no scope escalation, no replay, no secret
leakage, DB-enforced ownership invariants, deterministic reactivation, and
BLOCKED (never unsafe) behaviour when transactions are unavailable. All 48
Phase 4 security tests pass; the full backend regression (201 tests) passes.
