# Giri Gym — Device Attendance Complete Issues Register

Status: CURRENT · Updated 2026-09-02 · Branch: `attendance-feat`

Classification vocabulary:
`DONE` · `NOT DONE` · `BUG` · `CRITICAL BUG` · `BLOCKED` · `NOT APPLICABLE` ·
`CODE-REVIEW ONLY` · `PREVIOUSLY VERIFIED`

## Phase 0–3 — Implementation

| Finding | Classification | Evidence |
|---|---|---|
| DeviceActivation model (no kioskId at generation) | DONE | `backend/src/models/DeviceActivation.js` |
| DeviceRegistration DB invariants A/B/C | DONE | `deviceRegistration.test.js` Gate A/B/C — PASS |
| Atomic device switch (Mongo transaction) | DONE | `deviceActivationService.js` `redeemActivation` |
| Kiosk resolve rules (create/reuse/disabled/scope-mismatch) | DONE | KIOSK-1..4 PASS |
| Trainer-only route guards | DONE | `deviceRoutes.js` `requireRole("trainer")` |
| Super Admin scoped-attendance API | DONE | `adminAttendanceAuth.js`, `/admin-scope`, `/kiosk/admin-punch` |
| Admin activation UI (no Kiosk selector) | DONE | `AttendanceDevices.jsx` |
| Trainer device UI (code/QR/password) | DONE | `AttendanceMyDevices.jsx` |
| Role separation (sidebar + route guard exact mode) | DONE | `authContext.js` `canAccess exact`, `RoleGuard.jsx`, `AdminSidebar.jsx` |

## Phase 4 — Security + Concurrency

| Finding | Classification | Evidence |
|---|---|---|
| IDOR / ownership isolation | DONE | IDOR-1..7 PASS |
| Activation single-use + replay 409 | DONE | ACT-1, ACT-5, ACT-6 PASS |
| Brute-force generic failure (no enumeration) | DONE | RATE-1, RATE-2 PASS |
| Route-level 429 (dedicated redeem limiter) | CODE-REVIEW ONLY | wired at route; service-level verified |
| Device ownership invariants A + B (DB-enforced) | DONE | OWN-1..3 PASS; `deviceRegistration.test.js` |
| Kiosk state rules | DONE | KIOSK-1..4 PASS |
| Trainer scope change invalidation | DONE | SCOPE-1 PASS |
| Super Admin attendance token security | DONE | SA-1..10 PASS |
| Stale-browser precedence (backend) | CODE-REVIEW ONLY | no stale-cred fallback in backend |
| Bearer credential replayability | DONE (documented) | documented limitation; credential is bearer, not hardware attestation |
| NoSQL injection rejected | DONE | NOSQL-1..3 PASS |
| Secret leakage (responses clean) | DONE | NOSQL-2/3 PASS |
| Same-Trainer revoke → reactivate | DONE | REACT-A..G PASS (48/48) |
| ActiveRegistrationCount informational + consistent | DONE | COUNT-1 PASS |
| Super Admin data isolation (Male/Female+T) | DONE | ISO-1/2 PASS |
| Standalone Mongo transactions unavailable | BLOCKED by design | `redeemActivation` → 503, no non-atomic fallback |

## Phase 5 — E2E

| Finding | Classification | Evidence |
|---|---|---|
| Real 3-profile browser E2E | NOT DONE (pending) | Phase 5 |

## Phase 6 — Cleanup / Docs

| Finding | Classification | Evidence |
|---|---|---|
| Legacy provisioning/request/claim removal | DONE (code) / docs pending | provisioning files removed in earlier phase |
| Legacy constants/index cleanup | DONE | `constants.js`, `dbIndexes.js` updated |
| Final architecture/security/test docs | NOT DONE (pending) | Phase 6 |
| Final release gate | NOT DONE (pending) | Phase 6 |

## Known Non-Critical Issues (documented, do not block release)

1. **Frontend has no automated test harness** — `NOT APPLICABLE`; covered by
   manual + Phase 5 E2E + backend integration tests.
2. **Route-level 429 not executed in automated suite** — `CODE-REVIEW ONLY`;
   service-level generic-failure behaviour is verified.
3. **Bearer credential is replayable if copied from another browser** —
   documented accepted property (opaque credential, not hardware attestation);
   mitigations: random 256-bit key, single-active-device invariant, revoke/disable.

## Residual Risks

- **Production MongoDB topology** must be a replica set for transaction
  atomicity. Standalone deployments are BLOCKED for activation redemption.
- **`JWT_ADMIN_ATTENDANCE_SECRET`** defaults to the access secret if unset;
  production should set a dedicated value. Strict issuer/audience/algorithm
  validation prevents cross-use regardless.
