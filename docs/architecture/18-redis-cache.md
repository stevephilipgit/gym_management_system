# 18 — Redis / Cache

## All Redis usages (verified)

| Purpose | File | Key pattern | TTL | Impact if Redis down |
|---------|------|-------------|-----|---------------------|
| Rate limiting | `middleware/rateLimiter.js` | `rl_*:<identifier>` | per limiter | Rate limiters silently degrade to no-op (`if no msBeforeNext → next()`). No DOS protection. |
| CAPTCHA storage | `services/captchaService.js` | `captcha:<uuid>` | 5 min | CAPTCHA create/verify both fail. Login is impossible (no captcha = no login). The app continues running for existing sessions. |
| Health check | `controllers/healthController.js` | `redisClient.ping()` | — | Health check reports Redis as "error". |

**That is all.** Redis is NOT used for:
- Sessions (DEPLOYMENT_GUIDE claim is false)
- Business data caching (DEPLOYMENT_GUIDE claim is false)
- Message queues
- AI chat memory (in-process Map)
- Settings caching (in-process TTL cache)
- Rate-limiter block lists (rate-limiter-flexible uses Redis directly)

## Redis client configuration (`config/redis.js`)

- Connects automatically on import (top-level `redisClient.connect()`).
- Reconnect strategy: up to 5 retries, exponential backoff 200ms→2s, then quit.
- Events: `connect`, `error`, `reconnecting` (console.log only).
- 5-second connect timeout.

## Failure behavior

- **Startup:** `redisClient.connect()` is called at module import time (before
  server starts). If Redis is unreachable, the connect promise rejects but the
  error is **caught** (`redisClient.connect().catch(...)`) — the server starts
  without Redis. The rate limiter and CAPTCHA will fail on first use.
- **Rate limiter error path** (`rateLimiter.js:20-22`): if `limiter.consume()`
  throws and the error has no `msBeforeNext` (i.e., Redis error, not rate-limit
  hit), the middleware calls `next()` — allowing the request through without
  rate limiting. **Degraded security.**
- **CAPTCHA on Redis error:** `captchaService.create()` calls `redisClient.set()`
  — throws; `captchaService.verify()` calls `redisClient.eval()` — throws.
  Login is blocked because the captcha challenge cannot be created or verified.
  This is the effective failsafe (no rate limit + no login = DOS protection via
  login impossibility).
- **Health check:** `healthController` calls `redisClient.ping()`, `catch` sets
  status to "error" / "degraded".

## In-memory caches (not Redis)

| Cache | Location | Contents | TTL | Max size |
|-------|----------|----------|-----|----------|
| SystemSettings cache | `systemSettingsService.js` | Full settings document | 5 min | 1 entry |
| AI response cache | `services/ai/aiCache.js` | AI response text by query | 2 min | 100 entries |
| AI conversation store | `services/ai/conversationStore.js` | Session message history + memory | 30 min | unbounded (auto-cleanup) |
| AI pending actions | `services/ai/pendingActionStore.js` | Confirmation tokens | 5 min | 50 |

All in-process memory. Lost on server restart. Not shared across instances.