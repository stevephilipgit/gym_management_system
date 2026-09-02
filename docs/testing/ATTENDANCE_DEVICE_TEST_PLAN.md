# Attendance Device — Test Plan

## Backend Integration Tests (Mocha + Chai)

| Suite | File | Coverage |
|---|---|---|
| Device Registration invariants | `deviceRegistration.test.js` | Schema fields, INVARIANT A/B/C indexes, DB enforcement |
| Device Lifecycle | `deviceLifecycle.test.js` | Kiosk disable, scope reassign, credential rotation, concurrent activation |
| Kiosk | `kiosk.test.js` | kioskAuth, punch, ambiguous resolution, candidate selection, disabled Kiosk |
| Kiosk scoped punch | `kioskScopedPunch.test.js` | Scope-based member resolution, Male/Female/T isolation, integrity error |
| Security + Concurrency | `securityAndConcurrency.test.js` | IDOR, scope isolation, replay, expiry, wrong password, activation flow |
| Phase 4 Security | `phase4Security.test.js` | 48 tests: IDOR, activation, brute force, ownership, Kiosk state, scope change, SA token, stale state, bearer credential, NoSQL, secret leakage, reactivation lifecycle, data isolation |

## HTTP-Stage E2E (real backend + dedicated E2E DB)

| Scenario | File | Status |
|---|---|---|
| E2E-001..015 (14 automated) | `scripts/e2e/phase5E2E.mjs` | PASS |
| E2E-013 stale Trainer credentials (browser-only) | `docs/testing/PHASE_5_MANUAL_BROWSER_E2E_CHECKLIST.md` | MANUAL |

## Running Tests

```bash
cd backend

# Full device regression (requires replica-set MongoDB)
MONGO_URI="<atlas test db>" npx mocha src/tests/deviceRegistration.test.js \
  src/tests/deviceLifecycle.test.js src/tests/kiosk.test.js \
  src/tests/kioskScopedPunch.test.js src/tests/securityAndConcurrency.test.js \
  src/tests/scopeAndSessions.test.js src/tests/reportsRbac.test.js \
  src/tests/phase4Security.test.js --timeout 60000

# Phase 5 E2E suite (dedicated E2E DB required)
E2E_MONGO_URI="<atlas uri for gym_e2e_test>" node scripts/e2e/phase5E2E.mjs

# All-in-one regression runner (boots shared in-memory replica set)
node scripts/runFullDeviceRegression.mjs
```

## Frontend

No frontend automated test harness exists. Cover by:
- Backend integration tests (exercises same business logic)
- Phase 5 HTTP-stack E2E (exercises real API endpoints)
- Manual browser checklist for browser-only behavior