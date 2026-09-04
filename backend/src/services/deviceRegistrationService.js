// services/deviceRegistrationService.js - Device/browser registration lifecycle
//
// The trainer-facing device layer. Direct-activation flow uses these helpers
// to enforce uniqueness, deactivate old registrations, and produce safe
// public projections.
//
// Invariants enforced here:
//   - At most ONE active registration per trainer (partial unique index).
//   - Deactivate-then-create is the atomic device switch (the activation
//     service wraps it in a Mongo transaction when supported).
//   - Scope reassignment invalidates every registration in the SAME
//     transaction that changes the Kiosk scope, and stamps scopeChangedAt.

import mongoose from "mongoose";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import Admin from "../models/Admin.js";
import Kiosk from "../models/Kiosk.js";
import DeviceRegistration from "../models/DeviceRegistration.js";
import logger from "../core/logger.js";

const GENDERS_FOR_SCOPE = {
  male: ["Male"],
  female_plus_transgender: ["Female", "Transgender"],
};

export class DeviceError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
    this.name = "DeviceError";
  }
}

function generateCredential() {
  const key = crypto.randomBytes(32).toString("base64url");
  const fingerprint = crypto.createHash("sha256").update(key).digest("hex");
  return { key, fingerprint };
}

function toPublicRegistration(reg) {
  return {
    registrationId: reg.registrationId,
    kioskId: reg.kioskId,
    trainerId: reg.trainerId,
    browserDeviceId: reg.browserDeviceId,
    deviceLabel: reg.deviceLabel || "",
    active: reg.active,
    activatedAt: reg.activatedAt,
    deactivatedAt: reg.deactivatedAt,
    revokedAt: reg.revokedAt,
    lastSeenAt: reg.lastSeenAt,
    createdAt: reg.createdAt,
    locked: reg.locked || false,
    lockedAt: reg.lockedAt,
    unlockedAt: reg.unlockedAt,
    deactivationReason: reg.deactivationReason || null,
    reactivatedAt: reg.reactivatedAt,
  };
}

export { toPublicRegistration, GENDERS_FOR_SCOPE };

export async function deactivateRegistration({ registrationId, trainerId, isSuperAdmin = false }) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const reg = await DeviceRegistration.findOne({ registrationId }).session(session);
      if (!reg) throw new DeviceError(404, "Registration not found");
      if (!isSuperAdmin && String(reg.trainerId) !== String(trainerId)) {
        throw new DeviceError(403, "You may only deactivate your own device registration");
      }
      if (!reg.active) {
        throw new DeviceError(409, "Registration is already inactive");
      }
      const wasActive = reg.active;
      reg.active = false;
      reg.deactivatedAt = new Date();
      reg.deactivationReason = isSuperAdmin ? "revoked" : "trainer";
      // Trainer-initiated deactivation preserves the credential for secure
      // reactivation; Super Admin deactivation destroys it.
      if (isSuperAdmin) {
        reg.apiKeyHash = undefined;
        reg.keyFingerprint = undefined;
      }
      await reg.save({ session });
      // Decrement the Kiosk counter whenever an active registration is deactivated.
      if (wasActive) {
        await Kiosk.updateOne(
          { kioskId: reg.kioskId, activeRegistrationCount: { $gt: 0 } },
          { $inc: { activeRegistrationCount: -1 } },
          { session }
        );
      }
      const fresh = await DeviceRegistration.findById(reg._id).session(session);
      result = toPublicRegistration(fresh.toObject());
    });
    return result;
  } catch (err) {
    if (err instanceof DeviceError) throw err;
    logger.error("Device deactivation failed", { error: err.message });
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Temporarily lock a trainer's own active device registration.
 * Preserves credentials so the Trainer can unlock later without re-activation.
 */
export async function lockRegistration({ registrationId, trainerId, isSuperAdmin = false }) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const reg = await DeviceRegistration.findOne({ registrationId }).session(session);
      if (!reg) throw new DeviceError(404, "Registration not found");
      if (!isSuperAdmin && String(reg.trainerId) !== String(trainerId)) {
        throw new DeviceError(403, "You may only lock your own device registration");
      }
      if (!reg.active) throw new DeviceError(400, "Cannot lock an inactive registration");
      if (reg.locked) throw new DeviceError(400, "Registration is already locked");
      if (reg.revokedAt) throw new DeviceError(410, "Cannot lock a revoked registration");
      reg.locked = true;
      reg.lockedAt = new Date();
      reg.unlockedAt = null;
      await reg.save({ session });
      logger.info(`Device registration locked: ${registrationId} by trainer ${trainerId}`);
      result = { registrationId, locked: true, lockedAt: reg.lockedAt };
    });
    return result;
  } catch (err) {
    if (err instanceof DeviceError) throw err;
    logger.error("Device lock failed", { error: err.message });
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Unlock a previously locked device registration owned by the requesting Trainer.
 */
export async function unlockRegistration({ registrationId, trainerId, isSuperAdmin = false }) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const reg = await DeviceRegistration.findOne({ registrationId }).session(session);
      if (!reg) throw new DeviceError(404, "Registration not found");
      if (!isSuperAdmin && String(reg.trainerId) !== String(trainerId)) {
        throw new DeviceError(403, "You may only unlock your own device registration");
      }
      if (!reg.active) throw new DeviceError(400, "Cannot unlock an inactive registration");
      if (!reg.locked) throw new DeviceError(400, "Registration is not locked");
      if (reg.revokedAt) throw new DeviceError(410, "Cannot unlock a revoked registration");
      reg.locked = false;
      reg.unlockedAt = new Date();
      reg.lockedAt = null;
      await reg.save({ session });
      logger.info(`Device registration unlocked: ${registrationId} by trainer ${trainerId}`);
      result = { registrationId, locked: false, unlockedAt: reg.unlockedAt };
    });
    return result;
  } catch (err) {
    if (err instanceof DeviceError) throw err;
    logger.error("Device unlock failed", { error: err.message });
    throw err;
  } finally {
    await session.endSession();
  }
}

export async function revokeRegistration({ registrationId, isSuperAdmin = false }) {
  if (!isSuperAdmin) throw new DeviceError(403, "Only Super Admin can revoke a device registration");
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const reg = await DeviceRegistration.findOne({ registrationId }).session(session);
      if (!reg) throw new DeviceError(404, "Registration not found");
                  const wasActive = reg.active;
      reg.active = false;
      reg.revokedAt = new Date();
      reg.deactivationReason = "revoked";
      reg.apiKeyHash = undefined;
      reg.keyFingerprint = undefined;
      await reg.save({ session });
      if (wasActive) {
        await Kiosk.updateOne(
          { kioskId: reg.kioskId, activeRegistrationCount: { $gt: 0 } },
          { $inc: { activeRegistrationCount: -1 } },
          { session }
        );
      }
      const fresh = await DeviceRegistration.findById(reg._id).session(session);
      result = toPublicRegistration(fresh.toObject());
    });
    logger.info(`Device registration revoked: ${registrationId}`);
    return result;
  } catch (err) {
    if (err instanceof DeviceError) throw err;
    logger.error("Device revoke failed", { error: err.message });
    throw err;
  } finally {
    await session.endSession();
  }
}
/**
 * Re-activate a Trainer's own previously deactivated registration.
 *
 * SECURITY MODEL (server-authoritative — the frontend only exposes the action;
 * the backend authorizes every check below):
 *   1. Registration belongs to the authenticated Trainer.
 *   2. Registration is inactive.
 *   3. The deactivation was Trainer-initiated (deactivationReason === "trainer").
 *   4. revokedAt is null (Super Admin revoked / scope-reassigned are terminal).
 *   5. deactivationReason is NOT "replaced" / "revoked" / "scope_reassigned".
 *   6. The Trainer account is still active.
 *   7. The Trainer's current scope is valid and compatible with the Kiosk scope.
 *   8. No OTHER Trainer currently owns the same browser/Kiosk (INVARIANT B).
 *   9. The Kiosk exists and is enabled.
 *  10. No incompatible scope reassignment since activation (defense-in-depth).
 *  11. At most ONE active registration per Trainer (INVARIANT A).
 *
 * CREDENTIAL: a FRESH server-generated API key is issued at reactivation time
 * (never the stale preserved hash). The old preserved hash is overwritten, so
 * there is no credential-replay window. Ownership, scope, Kiosk health and the
 * partial unique indexes are all verified atomically in a Mongo transaction.
 *
 * @returns {{ registration: object, apiKey: string }}
 */
export async function reactivateRegistration({ registrationId, trainerId }) {
  if (!registrationId) throw new DeviceError(400, "registrationId is required");
  if (!trainerId || !mongoose.isValidObjectId(trainerId)) {
    throw new DeviceError(400, "Invalid trainer session");
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      // 6. Trainer account must still be active with a concrete scope.
      const trainer = await Admin.findById(trainerId)
        .select("role scope status")
        .session(session)
        .lean();
      if (!trainer || trainer.role !== "trainer") {
        throw new DeviceError(404, "Trainer not found");
      }
      if (trainer.status !== "active") {
        throw new DeviceError(403, "Trainer account is not active");
      }
      const scopes = ["male", "female_plus_transgender"];
      if (!scopes.includes(trainer.scope)) {
        throw new DeviceError(409, "Trainer has no valid attendance scope");
      }

      // 1–5. Load and validate the registration lifecycle state.
      const reg = await DeviceRegistration.findOne({ registrationId }).session(session);
      if (!reg) throw new DeviceError(404, "Registration not found");
      if (String(reg.trainerId) !== String(trainerId)) {
        throw new DeviceError(403, "You may only reactivate your own device registration");
      }
      if (reg.active) {
        throw new DeviceError(409, "Registration is already active");
      }
      if (reg.revokedAt) {
        throw new DeviceError(403, "A revoked registration cannot be reactivated");
      }
      if (reg.deactivationReason !== "trainer") {
        throw new DeviceError(403, "This registration is not eligible for reactivation");
      }

      // 9–10. Kiosk must exist, be enabled, and match the Trainer's scope.
      const kiosk = await Kiosk.findOne({ kioskId: reg.kioskId }).session(session).lean();
      if (!kiosk) {
        throw new DeviceError(404, "Attendance device not found");
      }
      if (!kiosk.enabled) {
        throw new DeviceError(409, "Attendance device is disabled");
      }
      if (kiosk.scope !== trainer.scope) {
        throw new DeviceError(409, "Attendance device scope conflict");
      }
      if (kiosk.scopeChangedAt && new Date(reg.activatedAt) < new Date(kiosk.scopeChangedAt)) {
        throw new DeviceError(409, "Attendance device was reassigned to a different scope");
      }

      // 8. INVARIANT B — no other active Trainer owner for this browser/Kiosk.
      const otherOwner = await DeviceRegistration.findOne({
        kioskId: reg.kioskId,
        active: true,
        trainerId: { $ne: trainerId },
      }).session(session);
      if (otherOwner) {
        throw new DeviceError(409, "This attendance device is in use by another trainer");
      }

      // 11. INVARIANT A — no other active registration for this Trainer.
      const otherActive = await DeviceRegistration.findOne({
        trainerId,
        active: true,
        registrationId: { $ne: reg.registrationId },
      }).session(session);
      if (otherActive) {
        throw new DeviceError(409, "You already have an active attendance device. Deactivate it first.");
      }

      // Issue a FRESH credential (Option A — never restore the stale hash).
      const { key, fingerprint } = generateCredential();

      reg.active = true;
      reg.deactivatedAt = null;
      reg.deactivationReason = null;
      reg.revokedAt = null;
      reg.locked = false;
      reg.lockedAt = null;
      reg.unlockedAt = null;
      reg.reactivatedAt = new Date();
      reg.activatedAt = new Date();
      reg.apiKeyHash = await bcrypt.hash(key, 10);
      reg.keyFingerprint = fingerprint;
      await reg.save({ session });

      await Kiosk.updateOne(
        { kioskId: reg.kioskId, activeRegistrationCount: { $gte: 0 } },
        { $inc: { activeRegistrationCount: 1 } },
        { session }
      );

      logger.info(`Device registration reactivated: ${registrationId} by trainer ${trainerId}`);
      result = { registration: toPublicRegistration(reg.toObject()), apiKey: key };
    });
    return result;
  } catch (err) {
    if (err instanceof DeviceError) throw err;
    if (err?.code === 11000) {
      throw new DeviceError(409, "Attendance device ownership conflict");
    }
    logger.error("Device reactivation failed", { error: err.message });
    throw err;
  } finally {
    await session.endSession();
  }
}

export async function rotateRegistration({ registrationId, isSuperAdmin = false }) {
  if (!isSuperAdmin) throw new DeviceError(403, "Only Super Admin can rotate a device credential");
  const reg = await DeviceRegistration.findOne({ registrationId });
  if (!reg) throw new DeviceError(404, "Registration not found");
  if (!reg.active) throw new DeviceError(409, "Only an active registration can be rotated");

  const { key, fingerprint } = generateCredential();
  reg.apiKeyHash = await bcrypt.hash(key, 10);
  reg.keyFingerprint = fingerprint;
  await reg.save();

  logger.info(`Device registration credential rotated: ${registrationId}`);
  return { registration: toPublicRegistration(reg.toObject()), apiKey: key };
}

export async function reassignKioskScope({ kioskId, newScope, isSuperAdmin = false }) {
  if (!isSuperAdmin) throw new DeviceError(403, "Only Super Admin can reassign a device scope");
  if (!["male", "female_plus_transgender"].includes(newScope)) {
    throw new DeviceError(400, "Invalid device scope");
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const kiosk = await Kiosk.findOne({ kioskId }).session(session);
      if (!kiosk) throw new DeviceError(404, "Attendance device not found");

      const now = new Date();
      await Kiosk.updateOne(
        { _id: kiosk._id },
        { $set: { scope: newScope, scopeChangedAt: now, activeRegistrationCount: 0 } },
        { session }
      );
            await DeviceRegistration.updateMany(
        { kioskId },
        { $set: { active: false, revokedAt: now, deactivationReason: "scope_reassigned" }, $unset: { apiKeyHash: "", keyFingerprint: "" } },
        { session }
      );
      result = { kioskId, scope: newScope, scopeChangedAt: now };
    });
    logger.warn(`Kiosk scope reassigned: ${kioskId} → ${newScope}`);
    return result;
  } catch (err) {
    if (err instanceof DeviceError) throw err;
    logger.error("Kiosk scope reassignment failed", { error: err.message });
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * List the current trainer's own registrations (active + historical).
 * Bounded/paginated, no credentials returned.
 */
export async function listTrainerRegistrations({ trainerId, page = 1, limit = 50 }) {
  const skip = Math.max(0, (page - 1) * limit);
  const docs = await DeviceRegistration.find({ trainerId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  const total = await DeviceRegistration.countDocuments({ trainerId });
  const registrations = docs.map(toPublicRegistration);
  return { registrations, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

/**
 * Revoke ALL active registrations belonging to a trainer.
 * Called when a trainer account is disabled or removed.
 */
export async function revokeTrainerRegistrations({ trainerId }) {
  const session = await mongoose.startSession();
  try {
    let count = 0;
    await session.withTransaction(async () => {
      const activeRegs = await DeviceRegistration.find({ trainerId, active: true }).session(session);
      for (const reg of activeRegs) {
        await DeviceRegistration.findOneAndUpdate(
          { _id: reg._id },
          {
            $set: { active: false, revokedAt: new Date(), deactivationReason: "revoked" },
            $unset: { apiKeyHash: "", keyFingerprint: "" }
          },
          { session, new: true }
        );
        await Kiosk.updateOne(
          { kioskId: reg.kioskId, activeRegistrationCount: { $gt: 0 } },
          { $inc: { activeRegistrationCount: -1 } },
          { session }
        );
        count++;
      }
    });
    if (count > 0) logger.info(`Trainer lifecycle: revoked ${count} registrations for trainer ${trainerId}`);
    return { revoked: count };
  } catch (err) {
    logger.error("Trainer registration revocation failed", { error: err.message });
    throw err;
  } finally {
    await session.endSession();
  }
}