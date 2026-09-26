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

// Strict credential shapes (fixed alphabet + bounded length) enforced before any
// I/O, so a kioskId/credential can never be shaped into a query operator:
//   X-Kiosk-Id  — server-issued kioskId / browserDeviceId: letters, digits, - _
//   X-Kiosk-Key — 32-byte base64url secret: letters, digits, - _ .
const KIOSK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const KIOSK_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

const INVALID_CREDENTIALS_MESSAGE = "Kiosk authentication failed.";

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

    // 2. Exactly-one lookup by (kioskId, keyFingerprint) — unique index.
    const reg = await DeviceRegistration.findOne({ kioskId, keyFingerprint: fingerprint }).lean();
    if (!reg) {
      logInvalidCredentials("unknown_credential", kioskId, sourceIp);
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }

    // 3. Lifecycle: active + not revoked + not locked.
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

    // 4. Exactly ONE bcrypt comparison confirms the key.
    const valid = await bcrypt.compare(apiKey, reg.apiKeyHash);
    if (!valid) {
      logInvalidCredentials("bad_key", kioskId, sourceIp);
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }

    // 5. Physical device must exist and be enabled (fail-closed).
    const kiosk = await Kiosk.findOne({ kioskId }).lean();
    if (!kiosk) {
      logInvalidCredentials("unknown_kiosk", kioskId, sourceIp);
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }
    if (!kiosk.enabled) {
      logInvalidCredentials("kiosk_disabled", kioskId, sourceIp);
      return res.status(403).json({
        success: false,
        message: "Kiosk is disabled. Contact gym staff.",
      });
    }

    // 6. Defense-in-depth: a registration older than the last scope reassignment
    //    is invalid even if it survived the invalidation transaction.
    if (kiosk.scopeChangedAt && new Date(reg.activatedAt) < new Date(kiosk.scopeChangedAt)) {
      logInvalidCredentials("stale_registration", kioskId, sourceIp);
      return res.status(401).json({
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }

    // Attach the kiosk principal with the SERVER-DERIVED scope.
    req.kiosk = {
      id: kiosk._id,
      kioskId: kiosk.kioskId,
      scope: kiosk.scope,
      registrationId: reg._id,
      principalType: "kiosk",
    };

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