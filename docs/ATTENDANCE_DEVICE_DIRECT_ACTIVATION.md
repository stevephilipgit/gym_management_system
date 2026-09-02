# Attendance Device — Direct Activation

Status: IMPLEMENTED (Phases 0–5) · Last updated: 2026-09-02

This document supersedes the older provisioning / request / approve / claim
workflow. The activation flow is now:

```
1. Super Admin opens /admin/devices and picks a trainer.
2. Super Admin clicks "Generate Activation" → POST /api/admin/devices/activate/generate
   → returns a 6-digit code + a QR secret (one-time, 15-minute expiry).
3. Trainer logs in on the new device, opens /admin/my-devices,
   enters the 6-digit code + their account password,
   → POST /api/admin/devices/activate.
4. The new device is bound to the trainer atomically (consume activation,
   deactivate any prior active registration for this trainer, create the
   new credentialed registration). A fresh API key is returned once and
   stored in localStorage.
5. The customer's kiosk punch page now works using the new credential.
```

## Removed artifacts

The following old artifacts were removed because they were part of the
provisioning / request / claim flow:

- `backend/src/services/provisioningService.js`
- `backend/src/models/ProvisioningToken.js`
- `backend/src/controllers/provisioningPublicController.js`
- `backend/src/controllers/provisioningAdminController.js`
- `backend/src/routes/provisioningPublicRoutes.js`
- `backend/src/routes/provisioningAdminRoutes.js`
- `backend/src/controllers/deviceRequestController.js`
- `backend/src/tests/utils/provisioningTestHelper.js`
- `backend/src/tests/provisioning.test.js`
- `backend/src/tests/provisioningApi.test.js`
- `backend/src/tests/provisioningGuard.test.js`
- `backend/src/tests/deviceRequestClaim.test.js`
- `backend/src/tests/deviceRequestApi.test.js`
- `backend/src/tests/deviceRequest.test.js`
- `backend/src/tests/deviceLifecycle.test.js`
- `frontend/src/pages/ProvisionKiosk.jsx`
- `frontend/src/utils/provisioningIdentity.js`
- `/provision` route in `frontend/src/App.jsx`
- `/api/provision/*` and `/api/admin/provisioning-tokens/*` routes in backend
- `submitDeviceRequest`, `approveRequest`, `rejectRequest`, `claimRequest`,
  `expireStaleRequests`, `countExpiredRequests`, `invalidateTrainerRequests`,
  `listTrainerRequests`, `listAllRequests` from
  `backend/src/services/deviceRegistrationService.js`

## API

| Method | Path | Role | Body | Returns |
|--------|------|------|------|---------|
| POST | `/api/admin/devices/activate/generate` | superadmin | `{ trainerId, kioskId }` | `{ activation: { code, secret, qrPayload, expiresAt, ... } }` |
| POST | `/api/admin/devices/activate` | trainer | `{ code, password, browserDeviceId }` | `{ registration, apiKey }` |
| GET  | `/api/admin/devices/my` | trainer | — | `{ registrations }` |
| GET  | `/api/admin/devices/all` | superadmin | — | `{ registrations }` |
| POST | `/api/admin/devices/:registrationId/deactivate` | trainer (own) / superadmin (any) | — | `{ registration }` |
| POST | `/api/admin/devices/:registrationId/revoke` | superadmin | — | `{ registration }` |
| POST | `/api/admin/devices/:registrationId/rotate` | superadmin | — | `{ registration, apiKey }` |
| POST | `/api/admin/devices/kiosks/:kioskId/reassign-scope` | superadmin | `{ scope }` | `{ kioskId, scope, scopeChangedAt }` |

## Security rules enforced

- Plaintext 6-digit code is **never persisted**. Only `bcrypt(code, 10)` hash is
  stored (`DeviceActivation.codeHash`).
- QR secret is one-time and high-entropy (`crypto.randomUUID`); never logged.
- Trainer password verification is server-side only, constant-time
  (`bcrypt.compare`), never logged.
- Activation is single-use (`usedAt` set in the same transaction); replay
  returns the same generic 401 to prevent enumeration.
- Trainer-bound (`targetTrainerId`) prevents cross-trainer code reuse.
- One active registration per trainer enforced by the partial unique index
  `idx_devicereg_trainer_active_unique`.
- MongoDB transaction used when supported; falls back to a sequential best-effort
  with the partial unique index as the safety net (BLOCKED is documented when
  neither guarantees atomicity).

## Tests

- `directDeviceActivation.test.js` — full activation flow against MongoDB.
- `securityAndConcurrency.test.js` — 33 scenarios (concurrency, IDOR,
  scope isolation, replay, enumeration).
- `deviceRegistration.test.js` — schema invariants, DB gates.
- `kiosk.test.js`, `kioskScopedPunch.test.js` — customer punch regression.

All pre-existing pass-rates were preserved (no regressions introduced).