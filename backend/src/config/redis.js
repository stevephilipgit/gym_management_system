import { createClient } from "redis";
import config from "./index.js";

const redisClient = createClient({
  url: config.db.redisUrl,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) => {
      if (retries > 5) {
        console.error("[Redis] Too many reconnect attempts. Giving up.");
        return false;
      }
      return Math.min(retries * 200, 2000);
    },
  },
});

redisClient.on("connect", () => console.log("[Redis] Connected"));
redisClient.on("error", (err) => console.error("[Redis] Error:", err.message));
redisClient.on("reconnecting", () => console.log("[Redis] Reconnecting..."));

redisClient.connect().catch((err) => {
  console.error("[Redis] Initial connection failed:", err.message);
});

// ─────────────────────────────────────────────────────────────────────────────
// Distributed lock + cache helpers
//
// All helpers are intentionally FAIL-SAFE so a Redis outage can never take the
// attendance counter offline:
//   - Locks  → fail-OPEN  (punches continue; MongoDB's unique index on
//                          { memberId, date } remains the final duplicate guard).
//   - Cache  → fail-OPEN  (getCache returns null → callers fall through to the
//                          authoritative MongoDB path).
//
// Lock ownership is proven with a random token so a slow request can never
// release a lock that a newer request already re-acquired after TTL expiry.
// ─────────────────────────────────────────────────────────────────────────────

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Acquire an exclusive distributed lock.
 *
 * @param {string} lockKey  e.g. "lock:punch:<memberId>"
 * @param {string} token    unique ownership token (crypto.randomUUID)
 * @param {number} ttlMs    lock lifetime in milliseconds (safety net on crash)
 * @returns {Promise<boolean>} true when the lock is held by the caller.
 *   Returns TRUE on Redis failure (fail-open) so a Redis outage never blocks
 *   a customer punch.
 */
export async function acquireLock(lockKey, token, ttlMs = 3000) {
  try {
    const res = await redisClient.set(lockKey, token, { NX: true, PX: ttlMs });
    return res === "OK";
  } catch (err) {
    // Fail-open: MongoDB still guarantees a single attendance row per
    // { memberId, date }, so worst case we lose the "nice" 429 and fall back
    // to the existing duplicate-key handling in attendanceService.punchIn.
    console.error(`[Redis] acquireLock failed for ${lockKey}:`, err.message);
    return true;
  }
}

/**
 * Release a lock ONLY when the stored value still equals our token.
 * Prevents a late release from deleting a lock re-acquired by another request.
 *
 * @returns {Promise<boolean>} true when this caller owned (and freed) the lock.
 */
export async function releaseLock(lockKey, token) {
  try {
    const deleted = await redisClient.eval(RELEASE_LOCK_SCRIPT, {
      keys: [lockKey],
      arguments: [String(token)],
    });
    return Number(deleted) === 1;
  } catch (err) {
    console.error(`[Redis] releaseLock failed for ${lockKey}:`, err.message);
    return false;
  }
}

/**
 * Read + JSON.parse a cached value.
 * @returns {Promise<object|null>} null on miss, malformed payload, or Redis error.
 */
export async function getCache(key) {
  try {
    const raw = await redisClient.get(key);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch (err) {
    // A corrupt entry must never 500 the request — treat it as a miss.
    console.error(`[Redis] getCache failed for ${key}:`, err.message);
    return null;
  }
}

/**
 * Store a JSON-serializable value with a TTL.
 * Fail-safe: swallows Redis errors (the caller keeps using the MongoDB path).
 */
export async function setCache(key, value, ttlSeconds = 1800) {
  try {
    await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
    return true;
  } catch (err) {
    console.error(`[Redis] setCache failed for ${key}:`, err.message);
    return false;
  }
}

/**
 * Delete a cached value. Fail-safe (never throws).
 */
export async function deleteCache(key) {
  try {
    await redisClient.del(key);
    return true;
  } catch (err) {
    console.error(`[Redis] deleteCache failed for ${key}:`, err.message);
    return false;
  }
}

/**
 * Record a cache key inside a "group" index so the whole group can be
 * invalidated later without a blocking SCAN/KEYS over the whole keyspace.
 *
 * The index itself expires on the same TTL as its members, so an abandoned
 * group cannot leak forever.
 *
 * @param {string} indexKey     e.g. "kiosk:cred:idx:<kioskId>"
 * @param {string} cacheKey     the value key to remember
 * @param {number} ttlSeconds   shared TTL for the value and the index
 */
export async function trackCacheKey(indexKey, cacheKey, ttlSeconds = 1800) {
  try {
    await redisClient.sAdd(indexKey, cacheKey);
    await redisClient.expire(indexKey, ttlSeconds);
    return true;
  } catch (err) {
    console.error(`[Redis] trackCacheKey failed for ${indexKey}:`, err.message);
    return false;
  }
}

/**
 * Delete every value key tracked under a group index, then drop the index.
 * This is what admin enable/disable, lock, revoke, rotate and scope-reassign
 * call so a cached kiosk principal can never outlive the DB state it mirrors.
 *
 * @returns {Promise<number>} how many keys were removed (0 on Redis error).
 */
export async function deleteCacheGroup(indexKey) {
  try {
    const members = await redisClient.sMembers(indexKey);
    if (Array.isArray(members) && members.length > 0) {
      await redisClient.del(members);
    }
    await redisClient.del(indexKey);
    return Array.isArray(members) ? members.length : 0;
  } catch (err) {
    console.error(`[Redis] deleteCacheGroup failed for ${indexKey}:`, err.message);
    return 0;
  }
}

export default redisClient;
