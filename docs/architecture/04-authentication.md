# 04 — Authentication (Login E2E)

## The complete login journey (verified)

```
Login.jsx (frontend/src/pages/Login.jsx)
  on mount → GET /api/admin/captcha        (captchaId + svgBase64)
  submit   → POST /api/admin/login {username, password, captchaId, captchaAnswer}
              ↓
adminRoutes.js:28  POST /login
  → loginLimiter (express-rate-limit, 5 req / 5 min / IP)
  → validateSchema(loginSchema)            (Joi: username 3-50, password ≥8, captchaId ≤64, captchaAnswer 1-6)
  → authController.login (authController.js:87)
      → captchaService.verify(captchaId, answer)  (Redis GETDEL — single use)
      → Admin.findOne({ $or: [{username regex}, {email regex}] })
      → bcrypt.compare(password, admin.passwordHash)
      → issueTokens(admin) → access JWT + refresh JWT
      → setAuthCookies(res)  → httpOnly cookies
      → auditActions.adminLogin
      → res.json({ success, token, admin: {id, username, fullName, email, role, scope} })
  ← Login.jsx navigates to /admin
```

## Where username/password are validated

| Layer | File | Rule |
|-------|------|------|
| Frontend | `Login.jsx:40-53` | non-empty username; password ≥ 8 chars; captcha answer non-empty |
| Backend schema | `schemas/authSchema.js:4-9` | username 3–50, password ≥8, captchaId ≤64, captchaAnswer 1–6 |
| Backend controller | `authController.js:98-119` | username/password required; case-insensitive username/email lookup; bcrypt.compare |
| Admin creation | `authController.js:12-26` + `createAdminSchema` | ≥8 chars, must contain upper+lower+digit |

Password policy is only enforced for **admin creation / password change**, not
for login (login just checks length ≥ 8).

## bcrypt usage

`authController.js`: login uses `bcrypt.compare(password, admin.passwordHash)`
(line 115). Admin creation/reset uses `bcrypt.hash(password, 10)` (lines 249,
397). 10 salt rounds. No pepper, no password re-hash on login, no account
lockout beyond rate limiting.

## CAPTCHA implementation (`services/captchaService.js`)

- 5-char answer from an ambiguity-safe alphabet; rendered server-side as SVG
  (base64); **answer never leaves the server**.
- Stored in Redis as JSON `{ answerHash: sha256(answer) }` with TTL 5 minutes.
- Verification uses a Lua **GETDEL** script — atomic read+delete, so each
  captcha is single-use even under concurrent requests.
- Comparison uses `crypto.timingSafeEqual`.

**Enforcement:** `POST /api/admin/login` always calls `captchaService.verify`
first. If the captcha fails, login is rejected before credential processing.
No bypass path found in code.

**CAPTCHA hardening note:** the SVG is simple (single font, low noise). It is a
real barrier for casual bots but is not a strong visual CAPTCHA.

## Brute-force protection

| Mechanism | File | Scope | Limits |
|-----------|------|-------|--------|
| loginLimiter | `adminRoutes.js:17-21` | IP | 5 requests / 5 min |
| captchaLimiter | `rateLimiter.js:43` | IP | 30 / 60s (on GET /captcha) |
| adminLimiter | `rateLimiter.js:41` | IP or admin id | 300 / 60s on /api/admin |
| Global limiter | `server.js:131-138` | IP | 120 / min on /api |
| Redis-based limiters | `rateLimiter.js` (rate-limiter-flexible) | IP or admin id | default 100/60s, sensitive 50/60s, otp 3/300s |

The express-rate-limit limiter is in-memory (per process). The
rate-limiter-flexible limiters use Redis.

**Failure behavior of Redis-backed limiters** (`rateLimiter.js:20-22`): if Redis
errors (no `msBeforeNext` number), the limiter calls `next()` — i.e., **rate
limiting silently degrades to off**. If Redis is down, the CAPTCHA also cannot
be created/verified (login becomes impossible), which is the effective failsafe.

## JWT creation / expiry

`authController.js:42-54` `issueTokens`:
- access token: `{ id, username, role, scope, email }`, secret
  `JWT_ACCESS_SECRET`, expiry `JWT_ACCESS_EXPIRES` (default 15m).
- refresh token: `{ id, username }`, secret `JWT_REFRESH_SECRET` (defaults to
  access secret), expiry `JWT_REFRESH_EXPIRES` (default 7d).

`adminAuth.js` decodes the access token and attaches
`req.admin = { id, username, role, scope }`.

## Cookie configuration (`authController.js:57-72`)

| Cookie | Contents | httpOnly | Secure | SameSite | Path | MaxAge |
|--------|----------|----------|--------|----------|------|--------|
| `gym_admin_token` | access JWT | yes | production only | strict | `/` | 15m |
| `gym_admin_refresh` | refresh JWT | yes | production only | strict | `/api/admin` | 7d |

- `sameSite=strict` is the primary CSRF defense (no csurf middleware exists —
  README/DEPLOYMENT_GUIDE claim is false).
- `secure` is **only enabled in production** (`config.app.isProduction`).
- No `__Host-` prefix; refresh cookie is scope-limited to `/api/admin` by path.

## Refresh mechanism

`adminRoutes.js:34` `POST /api/admin/refresh` →
`authController.refreshToken`:
- Reads `gym_admin_refresh` cookie, verifies with refresh secret.
- Loads the admin from DB by `decoded.id`.
- Rotates: issues new access + refresh pair (refresh token is single-use).
- Frontend `apiClient.js` intercepts 401s, does a **single-flight** refresh
  (`isRefreshing` + queue), replays queued requests.

## Logout

`adminRoutes.js:40` `POST /api/admin/logout` → clears both cookies and writes
an audit entry. Because sessions are **stateless JWTs**, logout does not
invalidate the token server-side — the token remains valid until expiry. This is
standard for cookie+JWT but means "logout" only removes the cookie.

## Failed login behavior

- Wrong credentials → `AuthError("Invalid credentials")` (401), generic — no
  account enumeration via login.
- Wrong captcha → 400 with message.
- Every failed attempt is rate-limited per IP.
- Audit: only **successful** logins are audited (`auditActions.adminLogin(req,
  admin._id, true)`). Failed attempts are not written to AuditLog (the
  auditLogger middleware does log the HTTP request path/status for /api/admin
  POST, so failed logins do appear in the `auditlogs` collection as
  `POST /api/admin/login -> 401`).

## Account enumeration risks

- Login: generic "Invalid credentials" — good.
- `POST /api/admin/forgot`: returns the same message whether or not the email
  exists ("If an account exists...") — good.
- `POST /api/admin/reset`: generic "Invalid or expired OTP" — good.
- `GET /admin/me`, admin list: authenticated/superadmin only.

## Password reset / OTP

- `forgotPassword` (authController.js:409): generates a 6-digit OTP, stores
  SHA-256 hash in the Admin document with a 10-minute expiry, sends email.
- `resetPasswordWithOTP` (authController.js:450): verifies hash + expiry, then
  sets the new password. OTP is single-use (field cleared after success).
- No OTP attempt counter / rate limit on `/reset` beyond `otpLimiter` (3 / 5 min
  via adminRoutes.js:64).

## Security mechanism review

1. **What protects us?** JWT in httpOnly+SameSite=strict cookies, bcrypt,
   server-side CAPTCHA (Redis, single-use), layered rate limits, helmet/CSP,
   NoSQL sanitizer.
2. **Where?** See table above; enforced in `authController.js` and middleware.
3. **Actually enforced?** Yes for login path.
4. **Bypassable?** CAPTCHA could be solved by a determined attacker (weak SVG);
   rate limits are per-IP (proxy-able); no account lockout; no failed-login
   audit granularity.
5. **Production-safe?** Mostly. Gaps: no CSRF token (relies on SameSite +
   CORS), `secure` cookie flag depends on NODE_ENV being correct, refresh
   secret defaults to access secret, no token revocation.
6. **If it fails?** Redis down → CAPTCHA unusable (login blocked) and rate
   limits disabled. JWT secret missing → server refuses to start
   (`validateEnv`).
