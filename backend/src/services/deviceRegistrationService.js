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
      if (reg.active) {
        reg.active = false;
        reg.deactivatedAt = new Date();
        reg.apiKeyHash = undefined;
        reg.keyFingerprint = undefined;
        await reg.save({ session });
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
        { $set: { active: false, revokedAt: now }, $unset: { apiKeyHash: "", keyFingerprint: "" } },
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
            $set: { active: false, revokedAt: new Date() },
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