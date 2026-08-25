# 06 — Session Management

## Model (post-hardening): stateless JWT + per-device session registry

Each login creates an `AdminSession` document (collection `adminsessions`).
Access/refresh JWTs carry a `sid` (session id) claim bound to that document.
`adminAuth` validates token signature **and** the session/account lifecycle on
every request.

```
Browser (Device A)            Browser (Device B)
  cookie gym_admin_token_<sidA> ─► adminAuth: X-Session-Id required
  cookie gym_admin_refresh_<sidA>─► jwt.verify + decoded.sid === header
                                   → Admin.findById          (exists + active?)
                                   → tokenVersion match?    (password change?)
                                   → AdminSession.findOne   (revoked? expired?)
                                   → req.admin {role, scope}  (fresh from DB)
```

## What is stored where

| Data | Location |
|------|----------|
| Access JWT (`id, username, role, scope, email, sid, tv, jti`) | httpOnly cookie `gym_admin_token_<sid>`, path `/` |
| Refresh JWT (`id, username, sid, tv, jti`) | httpOnly cookie `gym_admin_refresh_<sid>`, path `/api/admin` |
| Per-tab session pointer (opaque sid, NOT the JWT) | `sessionStorage.gym_session_id` |
| Session record (`sessionId, adminId, expiresAt, revokedAt, deviceName, ip`) | `AdminSession` collection |
| Admin lifecycle (`role, scope, status, tokenVersion`) | `admins` collection |
| Audit trail | `auditlogs` collection + Winston files |

## Cookie details (authController.js:75-103)

- `gym_admin_token_<sid>`: httpOnly, Secure in production, SameSite=strict,
  path `/`, 15m. Name embeds the session id (`utils/sessionCookies.js`).
- `gym_admin_refresh_<sid>`: httpOnly, Secure in production, SameSite=strict,
  path `/api/admin`, 7d.
- **No shared legacy cookie** — the `X-Session-Id` header is mandatory and
  selects the cookie pair. There is no bare-cookie fallback.

## Refresh / rotation

`POST /api/admin/refresh`: verifies refresh JWT → loads admin (exists/active) →
checks `tokenVersion` → checks the `sid` session is un-revoked/un-expired →
rotates **both** tokens bound to the same `sid`. A revoked session cannot
refresh. Frontend `apiClient` performs single-flight refresh + request queue.

## Token invalidation (all server-side)

| Event | Effect |
|-------|--------|
| Logout (current device) | `AdminSession.updateOne({sessionId}, revokedAt)` — **only this device's session** |
| Logout-all (current admin) | revoke all sessions of the admin |
| Password change / OTP reset | `tokenVersion += 1` **and** revoke all sessions |
| Admin disabled (`status='disabled'`) | `tokenVersion += 1` + revoke all sessions → instant 401 |
| Admin deleted | `AdminSession.deleteMany({adminId})` + admin gone → instant 401 |
| Role / scope change | `tokenVersion += 1` + revoke all sessions → forces re-login |

## Multi-device isolation (verified design)

```
Device A: Superadmin   ── session SA
Device B: Male trainer ── session MB
Device C: Female tr.   ── session FC
```

- All three sessions are independent documents with distinct `sid`s.
- **B logs out → only `MB` is revoked.** A and C keep working.
- A's password change → `tokenVersion` bump revokes SA, MB, FC **simultaneously**
  (all sessions of admin A only — B and C are different admins and unaffected).
- A's access token expired → B, C unaffected (per-browser cookies).
- No shared server-side "isLoggedIn" boolean exists; there is no global logout
  state.

## Frontend state

- No localStorage auth; only theme is stored locally.
- AuthGuard fetches `GET /admin/me` on mount; 401 → single-flight refresh →
  login redirect.
- Logout does a full `window.location.href = "/login"` reload, discarding all
  React state.

## Failure analysis

| Scenario | Behavior |
|----------|----------|
| Access token expired | 401 → auto-refresh → new pair (session must still be valid) |
| Refresh token expired/revoked | refresh fails → cookies cleared → /login |
| Session revoked (logout on another tab is same session!) | 401 immediately |
| Admin deleted/disabled | 401 immediately (DB check in adminAuth) |
| Password changed on another device | old tokens 401 immediately |
| Redis down | rate limits degrade, CAPTCHA fails (login blocked); existing sessions keep working |
| Secret rotation | all tokens invalid → re-login |
| Deployment upgrade (new `sid` claims) | existing cookies rejected once → users re-login (expected one-time) |
