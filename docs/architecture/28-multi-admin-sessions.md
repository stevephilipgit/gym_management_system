# 28 — Multi-Admin Sessions & Same-Browser Tab Isolation

## Problem

Cookie-based authentication is **per-browser, not per-tab**. `gym_admin_token`
was a single cookie name; logging in as a second admin in another tab of the
same browser overwrote it. The first tab silently became the second admin —
the reported "superadmin tab became the female trainer session" bug.

## Browser limitation (verified)

A browser cookie is keyed by `(name, domain, path)`. Two tabs in the same
origin share the exact same cookie jar. Therefore **two different values cannot
exist for one cookie name in one browser simultaneously**, and the server
cannot tell which tab made a request from the cookie alone.

True same-browser multi-account therefore requires either:
- moving the credential to per-tab JS storage (localStorage/sessionStorage) —
  **rejected**: it is a security downgrade (loses HttpOnly, invites XSS token
  theft), or
- **per-session cookie names + a per-tab session selector** — the design
  implemented here.

## Implemented architecture

### Per-session cookie pairs

Each login creates an `AdminSession` and its own cookie pair:

```
gym_admin_token_<sessionId>      (httpOnly, Secure, SameSite=strict, path /)
gym_admin_refresh_<sessionId>    (httpOnly, Secure, SameSite=strict, path /api/admin)
```

Cookie names are produced by `utils/sessionCookies.js`:
`sessionCookieName(sessionId, type)` → `gym_admin_token_<sid>`.

### Per-tab session selector (X-Session-Id)

- The **login response returns `sessionId`** (`authController.login`).
- The frontend stores **only the opaque session id** in `sessionStorage`
  (per-tab, cleared when the tab closes): `gym_session_id`.
- `utils/apiClient.js` attaches `X-Session-Id: <sid>` to every request.
- `backend/src/middleware/adminAuth.js` resolves the token from the cookie pair
  matching the header sid, and **requires the token's `sid` claim to equal the
  header sid**.
- Legacy cookie names are still accepted as a fallback (transitional) and are
  cleared on login/logout.

This keeps **every JWT in an HttpOnly cookie**. `sessionStorage` holds only an
opaque pointer; without the matching HttpOnly token it is useless, and the
server cross-checks the two.

### What it achieves

| Scenario | Before | After |
|----------|--------|-------|
| Superadmin (Tab A) + Female trainer (Tab B), same browser | Tab A silently became female trainer | Tab A keeps sending its own sid → its own cookie pair → stays superadmin; Tab B is female trainer |
| Logout in Tab B | cleared the shared cookie → killed Tab A too | revokes only Tab B's session, clears only Tab B's cookie pair |
| Refresh rotation | shared cookie | per-session cookie rotated in place |
| Different browsers/devices | independent (AdminSession) | unchanged and still independent |

### Backend control points

- `backend/src/utils/sessionCookies.js` — cookie name helper (pure).
- `backend/src/controllers/authController.js`:
  - `setAuthCookies(res, tokens, sessionId)` — per-session names; clears legacy.
  - `clearAuthCookies(res, sessionId)` — clears per-session + legacy.
  - `resolveRequestSessionId(req)` — header sid (authoritative) or legacy decode.
  - `login` returns `sessionId`; `refreshToken` validates header-vs-token sid;
    `logout`/`logoutAllSessions` revoke the specific session.
- `backend/src/middleware/adminAuth.js` — picks the cookie pair by `X-Session-Id`,
  requires `decoded.sid === headerSid`, then the existing admin/session checks.
- `backend/src/server.js` — CORS `allowedHeaders: ["Content-Type", "X-Session-Id"]`.

### Frontend control points

- `frontend/src/utils/apiClient.js` — request interceptor sets `X-Session-Id`
  from `sessionStorage`; `refreshSession` sends it; `redirectToLogin` clears it.
- `frontend/src/pages/Login.jsx` — stores `sessionId` after login.
- `frontend/src/admin/components/Authguard.jsx` — re-syncs/clears the per-tab sid.
- `frontend/src/admin/AdminSidebar.jsx` — clears the sid on logout.

## Security trade-offs (honest statement)

- **What is technically possible:** true per-tab isolation while keeping JWTs
  HttpOnly, via per-session cookie names + `X-Session-Id` (a custom header,
  which also adds a CORS preflight requirement — improving CSRF resistance).
- **What is not possible:** two independent sessions under the *same* cookie
  name in the same browser, and zero shared cookies between tabs. Some residual
  cookie pairs from other sessions remain in the jar until expiry (harmless —
  they are only usable with the matching sid, which lives in the other tab).
- **Trade-off:** the sid in `sessionStorage` is readable by JS in that tab.
  This is equivalent to a session-cookie value, and is NOT the JWT; exploitation
  still requires the HttpOnly JWT, so XSS impact is no worse than any
  cookie-based app. The sid is cleared on tab close and on logout.

## Fallback behavior (removed)

The legacy fallback (`gym_admin_token` shared cookie) was removed in the
`fix/session-legacy-migration` branch. The `X-Session-Id` header is now
**mandatory**. Requests without it are rejected with 401. This is safe because
the current frontend (apiClient) always sends the header. Legacy clients must
re-login to obtain a per-session cookie pair.
