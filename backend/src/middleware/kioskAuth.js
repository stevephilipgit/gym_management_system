// middleware/kioskAuth.js - Device credential authentication middleware
//
// Phase 2: authentication is via DeviceRegistration, NOT the Kiosk document.
// The physical Kiosk is identified by X-Kiosk-Id; the browser's credential is
// verified against a DeviceRegistration bound to that Kiosk.
//
// Lookup (Database Invariant Gate #4 — exactly ONE bcrypt compare):
//   fingerprint = sha256(apiKey).hex                       // 64-hex
//   DeviceRegistration.findOne({ kioskId, keyFingerprint }) // unique index → ≤1
//   bcrypt.compare(apiKey, reg.apiKeyHash)                 // EXACTLY 1 compare
//   verify active, not revoked
//   load Kiosk → verify enabled + registration not older than scopeChangedAt
//
// This is a SEPARATE principal from adminAuth. A device credential:
//   - identifies an authorized browser/device registration for a physical Kiosk
//   - attaches req.kiosk = { id, kioskId, scope, registrationId }
//   - NEVER satisfies adminAuth / requireRole
//   - allows only the narrow kiosk punch endpoint
//
// Device scope comes from the SERVER-LOADED Kiosk doc — never from the client.

import crypto from "crypto";
import bcrypt from "bcryptjs";
import Kiosk from "../models/Kiosk.js";
import DeviceRegistration from "../models/DeviceRegistration.js";
import logger from "../core/logger.js";
import {
  getCache,
  setCache,
  trackCacheKey,
  deleteCacheGroup,
} from "../config/redis.js";

// Strict credential shapes (fixed alphabet + bounded length) enforced before any
// I/O, so a kioskId/credential can never be shaped into a query operator:
//   X-Kiosk-Id  — server-issued kioskId / browserDeviceId: letters, digits, - _
//   X-Kiosk-Key — 32-byte base64url secret: letters, digits, - _ .
const KIOSK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const KIOSK_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

const INVALID_CREDENTIALS_MESSAGE = "Kiosk authentication failed.";

// ── Redis credential cache ──────────────────────────────────────────────────
// A validated kiosk principal is cached for 30 minutes so a busy counter does
// not pay for a DeviceRegistration lookup + a bcrypt compare on every single
// punch (bcrypt at cost 10 dominates the kiosk latency budget).
//
// Safety model:
//   - The cache key is `kiosk:cred:<kioskId>:<sha256(apiKey)>`, so a cache hit
//     is only ever possible for a credential that previously passed the FULL
//     check below. The secret itself is never stored in Redis.
//   - Every cache entry is tracked in the group index `kiosk:cred:idx:<kioskId>`
//     so ANY admin mutation (enable/disable, lock, deactivate, revoke, rotate,
//     scope reassign, kiosk delete) can drop the whole group instantly.
//   - Any cache read failure is treated as a MISS and falls through to MongoDB.
const CRED_CACHE_TTL_SECONDS = 1800; // 30 minutes
const CRED_CACHE_PREFIX = "kiosk:cred:";
const CRED_CACHE_INDEX_PREFIX = "kiosk:cred:idx:";

const buildCredCacheKey = (kioskId, fingerprint) =>
  `${CRED_CACHE_PREFIX}${kioskId}:${fingerprint}`;

const buildCredCacheIndex = (kioskId) =>
  `${CRED_CACHE_INDEX_PREFIX}${kioskId}`;

/**
 * Drop every cached credential for a kiosk.
 *
 * MUST be called by every admin path that changes kiosk/registration state
 * (enable, disable, lock, unlock, deactivate, revoke, rotate, scope
 * reassignment, kiosk delete). Without it, a cached principal could keep
 * punching for up to 30 minutes after the device was revoked.
 *
 * Fail-safe: never throws, so it is safe to `await` inline in a controller.
 *
 * @param {string} kioskId
 */
export async function invalidateKioskCredentialCache(kioskId) {
  if (!kioskId || typeof kioskId !== "string") return 0;
  return deleteCacheGroup(buildCredCacheIndex(kioskId));
}

// Throttle lastSeenAt writes to at most once per 5 minutes per registration.
const lastSeenAtCache = new Map();

// Structured security event — deliberately excludes the credential and all
// member PII (only the kiosk identity, reason and source IP are recorded).
function logInvalidCredentials(reason, kioskId, ip) {
  logger.warn("INVALID_CREDENTIALS", {
    principal: "kiosk",
    reason,
    kioskId: typeof kioskId === "string" ? kioskId.slice(0, 64) : null,
    ip: ip || null,
  });
}

export default async function kioskAuth(req, res, next) {
  const sourceIp = req.ip;
  try {
    const kioskId = req.get("x-kiosk-id");
    const apiKey = req.get("x-kiosk-key");

    if (!kioskId || !apiKey) {
      return res.status(401).json({
        success: false,
        message: "Kiosk authentication required.",
      });
    }

    // 0. Shape validation first: no hashing, no query, no bcrypt on garbage.
    if (!KIOSK_ID_PATTERN.test(kioskId) || !KIOSK_KEY_PATTERN.test(apiKey)) {
      logInvalidCredentials("malformed_headers", kioskId, sourceIp);
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }

    // 1. Compute the indexed prefilter fingerprint.
    const fingerprint = crypto.createHash("sha256").update(apiKey).digest("hex");

    // 2. FAST PATH — a previously validated principal for this exact
    //    (kioskId, key fingerprint) pair. Skips the DeviceRegistration lookup
    //    AND the bcrypt compare. Any error is a miss (getCache never throws).
    //    A principal WITHOUT branchId is a pre-multi-branch cache entry: it is
    //    treated as a miss so the full check below re-attaches the branch
    //    (fail-closed — a stale entry can never punch unscoped).
    const credCacheKey = buildCredCacheKey(kioskId, fingerprint);
    const cached = await getCache(credCacheKey);
    if (cached && cached.principal && cached.principal.branchId) {
      // Defence in depth: the cached snapshot still has to agree with itself.
      if (cached.locked) {
        logInvalidCredentials("device_locked", kioskId, sourceIp);
        return res.status(403).json({
          success: false,
          message: "Device is locked. Unlock it to continue attendance.",
        });
      }
      if (!cached.enabled) {
        logInvalidCredentials("kiosk_disabled", kioskId, sourceIp);
        return res.status(403).json({
          success: false,
          message: "Kiosk is disabled. Contact gym staff.",
        });
      }
      // Defense-in-depth: a registration older than the last scope reassignment
      // is invalid even if it survived the invalidation transaction.
      if (
        cached.scopeChangedAt &&
        new Date(cached.activatedAt) < new Date(cached.scopeChangedAt)
      ) {
        logInvalidCredentials("stale_registration", kioskId, sourceIp);
        return res.status(401).json({
          success: false,
          message: INVALID_CREDENTIALS_MESSAGE,
        });
      }

      req.kiosk = cached.principal;
      return next();
    }

    // 3. Exactly-one lookup by (kioskId, keyFingerprint) — unique index.
    const reg = await DeviceRegistration.findOne({ kioskId, keyFingerprint: fingerprint }).lean();
    if (!reg) {
      logInvalidCredentials("unknown_credential", kioskId, sourceIp);
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }

    // 4. Lifecycle: active + not revoked + not locked.
    if (!reg.active || reg.revokedAt) {
      logInvalidCredentials("inactive_registration", kioskId, sourceIp);
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }
    if (reg.locked) {
      logInvalidCredentials("device_locked", kioskId, sourceIp);
      return res.status(403).json({
        success: false,
        message: "Device is locked. Unlock it to continue attendance.",
      });
    }

    // 5. Exactly ONE bcrypt comparison confirms the key.
    const valid = await bcrypt.compare(apiKey, reg.apiKeyHash);
    if (!valid) {
      logInvalidCredentials("bad_key", kioskId, sourceIp);
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }

    // 6. Physical device must exist and be enabled (fail-closed).
    // kioskId is only unique PER BRANCH ({branchId, kioskId} compound), and a
    // DeviceRegistration does not record a branch — so if the same kioskId is
    // provisioned in two branches this lookup is genuinely ambiguous. Fail
    // closed (401) instead of picking an arbitrary branch's device.
    const kiosks = await Kiosk.find({ kioskId }).lean();
    if (kiosks.length === 0) {
      logInvalidCredentials("unknown_kiosk", kioskId, sourceIp);
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }
    if (kiosks.length > 1) {
      logInvalidCredentials("ambiguous_kiosk", kioskId, sourceIp);
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }
    const kiosk = kiosks[0];
    if (!kiosk.enabled) {
      logInvalidCredentials("kiosk_disabled", kioskId, sourceIp);
      return res.status(403).json({
        success: false,
        message: "Kiosk is disabled. Contact gym staff.",
      });
    }

    // 7. Defense-in-depth: a registration older than the last scope reassignment
    //    is invalid even if it survived the invalidation transaction.
    if (kiosk.scopeChangedAt && new Date(reg.activatedAt) < new Date(kiosk.scopeChangedAt)) {
      logInvalidCredentials("stale_registration", kioskId, sourceIp);
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }

    // Attach the kiosk principal with the SERVER-DERIVED scope and branch.
    req.kiosk = {
      id: kiosk._id,
      kioskId: kiosk.kioskId,
      scope: kiosk.scope,
      branchId: kiosk.branchId,
      registrationId: reg._id,
      principalType: "kiosk",
    };

    // 8. Cache the validated principal for CRED_CACHE_TTL_SECONDS so the next
    //    punch on this device skips the bcrypt compare. Only reached after the
    //    FULL validation above, and tracked under the kiosk group index so any
    //    later admin mutation (enable/lock/revoke/rotate/scope) drops it.
    //    The raw key and the bcrypt hash are NEVER written to Redis.
    await setCache(
      credCacheKey,
      {
        principal: req.kiosk,
        enabled: true,
        locked: false,
        activatedAt: reg.activatedAt ? new Date(reg.activatedAt).toISOString() : null,
        scopeChangedAt: kiosk.scopeChangedAt
          ? new Date(kiosk.scopeChangedAt).toISOString()
          : null,
      },
      CRED_CACHE_TTL_SECONDS
    );
    await trackCacheKey(
      buildCredCacheIndex(kioskId),
      credCacheKey,
      CRED_CACHE_TTL_SECONDS
    );

    // Rate-limited lastSeenAt update.
    const now = Date.now();
    const cacheKey = String(reg._id);
    const last = lastSeenAtCache.get(cacheKey);
    if (!last || now - last > 5 * 60 * 1000) {
      lastSeenAtCache.set(cacheKey, now);
      DeviceRegistration.updateOne({ _id: reg._id }, { lastSeenAt: new Date() }).catch(() => {});
    }

    next();
  } catch (err) {
    logInvalidCredentials("lookup_error", null, sourceIp);
    return res.status(401).json({
      success: false,
      message: INVALID_CREDENTIALS_MESSAGE,
    });
  }
}