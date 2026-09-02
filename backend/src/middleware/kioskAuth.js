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

// Throttle lastSeenAt writes to at most once per 5 minutes per registration.
const lastSeenAtCache = new Map();

export default async function kioskAuth(req, res, next) {
  try {
    const kioskId = req.get("x-kiosk-id");
    const apiKey = req.get("x-kiosk-key");

    if (!kioskId || !apiKey) {
      return res.status(401).json({
        success: false,
        message: "Kiosk authentication required.",
      });
    }

    // 1. Compute the indexed prefilter fingerprint.
    const fingerprint = crypto.createHash("sha256").update(apiKey).digest("hex");

    // 2. Exactly-one lookup by (kioskId, keyFingerprint) — unique index.
    const reg = await DeviceRegistration.findOne({ kioskId, keyFingerprint: fingerprint }).lean();
    if (!reg) {
      return res.status(401).json({
        success: false,
        message: "Kiosk authentication failed.",
      });
    }

    // 3. Lifecycle: active + not revoked.
    if (!reg.active || reg.revokedAt) {
      return res.status(401).json({
        success: false,
        message: "Kiosk authentication failed.",
      });
    }

    // 4. Exactly ONE bcrypt comparison confirms the key.
    const valid = await bcrypt.compare(apiKey, reg.apiKeyHash);
    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Kiosk authentication failed.",
      });
    }

    // 5. Physical device must exist and be enabled (fail-closed).
    const kiosk = await Kiosk.findOne({ kioskId }).lean();
    if (!kiosk) {
      return res.status(401).json({
        success: false,
        message: "Kiosk authentication failed.",
      });
    }
    if (!kiosk.enabled) {
      return res.status(403).json({
        success: false,
        message: "Kiosk is disabled. Contact gym staff.",
      });
    }

    // 6. Defense-in-depth: a registration older than the last scope reassignment
    //    is invalid even if it survived the invalidation transaction.
    if (kiosk.scopeChangedAt && new Date(reg.activatedAt) < new Date(kiosk.scopeChangedAt)) {
      return res.status(401).json({
        success: false,
        message: "Kiosk authentication failed.",
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
    return res.status(401).json({
      success: false,
      message: "Kiosk authentication failed.",
    });
  }
}