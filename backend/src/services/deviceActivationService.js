// services/deviceActivationService.js - Trainer attendance device activation
//
// MODE 1: Super Admin generates a one-time activation for a Trainer; the
// Trainer redeems it on the browser/device they want to use. The physical
// device is determined at redemption (kioskId = browserDeviceId).
//
// Security contract:
//   - Activation is bound to a specific Trainer (targetTrainerId).
//   - Scope is derived server-side from the Trainer record at generation and
//     frozen on the activation. NEVER from client input.
//   - Plaintext code/QR secret exist only transiently (hashes stored, bcrypt).
//   - Single-use: QR and 6-digit code are two mechanisms for ONE activation
//     lifecycle; whichever succeeds first consumes it.
//   - Short configurable TTL (default 120s).
//   - Trainer password confirmation at redemption.
//   - Atomic device switch inside a Mongo transaction (REQUIRED).
//
// Invariants enforced at DB level (see DeviceRegistration indexes):
//   A. One active attendance device per Trainer.
//   B. One active Trainer owner per browserDeviceId/Kiosk.
//
// If the Mongo topology does not support transactions, redemption is BLOCKED
// (503) — we never run a non-atomic sequential fallback.

import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import DeviceRegistration from "../models/DeviceRegistration.js";
import DeviceActivation from "../models/DeviceActivation.js";
import Kiosk from "../models/Kiosk.js";
import Admin from "../models/Admin.js";
import logger from "../core/logger.js";
import config from "../config/index.js";
import { auditLog } from "../utils/auditLog.js";
import { ACTION_TYPES } from "../core/constants.js";

const DEFAULT_TTL_MS = 120 * 1000;

export class DeviceActivationError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
    this.name = "DeviceActivationError";
  }
}

function activationTtlMs() {
  const env = config.activation?.ttlSeconds;
  const n = Number(env);
  if (Number.isFinite(n) && n > 0) return n * 1000;
  return DEFAULT_TTL_MS;
}

function randomSixDigitCode() {
  // crypto-safe; 000000..999999 (zero-padded).
  return String(Math.floor(crypto.randomInt(0, 1000000))).padStart(6, "0");
}

function makeActivationSecret() {
  return crypto.randomUUID(); // 122 bits of entropy
}

function normalizeScope(scope) {
  if (scope === "male" || scope === "female_plus_transgender") return scope;
  throw new DeviceActivationError(400, "Invalid device scope");
}

function toActivationPublic(doc) {
  return {
    activationId: doc.activationId,
    trainerId: doc.trainerId,
    scope: doc.scope,
    expiresAt: doc.expiresAt,
    usedAt: doc.usedAt,
    revokedAt: doc.revokedAt,
    usedByMethod: doc.usedByMethod,
    createdAt: doc.createdAt,
  };
}

/**
 * Generate a one-time activation for a Trainer.
 * @param {{ trainerId: string, createdBy?: string }} params
 */
export async function generateActivation({ trainerId, createdBy }) {
  if (!trainerId) {
    throw new DeviceActivationError(400, "trainerId is required");
  }
  if (trainerId instanceof mongoose.Types.ObjectId) {
    trainerId = String(trainerId);
  }
  if (typeof trainerId !== "string" || !mongoose.isValidObjectId(trainerId)) {
    throw new DeviceActivationError(400, "Invalid trainerId");
  }

  const trainer = await Admin.findById(trainerId)
    .select("role scope status")
    .lean();
  if (!trainer || trainer.role !== "trainer") {
    throw new DeviceActivationError(404, "Trainer not found");
  }
  if (trainer.status !== "active") {
    throw new DeviceActivationError(409, "Trainer is not active");
  }

  // Scope from the authoritative Trainer record (Rule 1). Trainers must have a
  // concrete scope — "all" is invalid for a Trainer.
  let scope;
  try {
    scope = normalizeScope(trainer.scope);
  } catch {
    throw new DeviceActivationError(409, "Trainer has no valid attendance scope");
  }

  // Revoke all prior unused activations for this Trainer (single-live-code).
  await DeviceActivation.updateMany(
    { trainerId: trainer._id, usedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  const code = randomSixDigitCode();
  const secret = makeActivationSecret();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + activationTtlMs());

  const record = await DeviceActivation.create({
    activationId: crypto.randomUUID(),
    trainerId: trainer._id,
    scope,
    codeHash: await bcrypt.hash(code, 10),
    secretHash: await bcrypt.hash(secret, 10),
    createdBy: createdBy || null,
    expiresAt,
  });

  logger.info("Activation generated", {
    activationId: record.activationId,
    trainerId: String(trainer._id),
    scope,
    ttlMs: activationTtlMs(),
    createdBy: createdBy || null,
  });

  return {
    activationId: record.activationId,
    code,
    qrPayload: secret,
    scope,
    expiresAt,
    trainerId: String(trainer._id),
  };
}

function transactionUnsupported(err) {
  if (!err) return false;
  if (err.errorLabels?.includes("UnknownTransactionCommitResult")) return true;
  if (err.codeName === "IllegalOperation") return true;
  if (err.code === 20) return true;
  const m = err.message || "";
  return (
    /Transaction numbers are only allowed/i.test(m) ||
    /Transactions are not supported/i.test(m) ||
    /not supported in standalone/i.test(m) ||
    /replica set/i.test(m)
  );
}

/**
 * Redeem an activation: bind the current browser/device to the Trainer.
 *
 * trainerId comes ONLY from the authenticated session (req.admin.id).
 *
 * @param {{ trainerId: string, browserDeviceId: string, code?: string, qrSecret?: string, password: string, req?: object }} params
 */
export async function redeemActivation({ trainerId, browserDeviceId, code, qrSecret, password, req }) {
  // ── Validation ────────────────────────────────────────────────────────
  if (!trainerId || !mongoose.isValidObjectId(trainerId)) {
    throw new DeviceActivationError(400, "Invalid trainer session");
  }
  if (typeof browserDeviceId !== "string" || !browserDeviceId.trim()) {
    throw new DeviceActivationError(400, "browserDeviceId is required");
  }
  if (browserDeviceId.length > 200) {
    throw new DeviceActivationError(400, "browserDeviceId is invalid");
  }
  // Reject objects / nested Mongo operators / non-plain strings.
  if (/[^\w.:-]/.test(browserDeviceId)) {
    throw new DeviceActivationError(400, "browserDeviceId is invalid");
  }
  const hasCode = typeof code === "string" && code.length > 0;
  const hasSecret = typeof qrSecret === "string" && qrSecret.length > 0;
  if (!hasCode && !hasSecret) {
    throw new DeviceActivationError(400, "Activation code or QR secret is required");
  }
  if (typeof password !== "string" || password.length === 0) {
    throw new DeviceActivationError(400, "Password is required");
  }

  // ── Load + verify Trainer ─────────────────────────────────────────────
  const trainer = await Admin.findById(trainerId)
    .select("role scope status passwordHash")
    .lean();
  if (!trainer || trainer.role !== "trainer" || trainer.status !== "active") {
    throw new DeviceActivationError(401, "Activation is invalid or expired");
  }

  // Find candidate activations for this Trainer (unexpired, unused, unrevoked).
  const now = new Date();
  const candidates = await DeviceActivation.find({
    trainerId: trainer._id,
    expiresAt: { $gt: now },
    usedAt: null,
    revokedAt: null,
  }).lean();

  // bcrypt-compare code or secret (constant-time per candidate).
  let activation = null;
  let method = null;
  for (const cand of candidates) {
    if (hasCode && cand.codeHash && (await bcrypt.compare(code, cand.codeHash))) {
      activation = cand; method = "code"; break;
    }
    if (hasSecret && cand.secretHash && (await bcrypt.compare(qrSecret, cand.secretHash))) {
      activation = cand; method = "qr"; break;
    }
  }

  // If no live (unused) activation matched, check whether this code/secret
  // belongs to an ALREADY-USED activation for this Trainer. Replay after a
  // commit-with-lost-response must return a deterministic, safe 409 (never a
  // second device, never a generic 401 that leaves the client guessing whether
  // the switch happened). Only the possession of the exact code/secret can
  // trigger this — it leaks nothing about other codes.
  if (!activation) {
    const usedDoc = await DeviceActivation.findOne({
      trainerId: trainer._id,
      usedAt: { $ne: null },
      revokedAt: null,
    }).lean();
    if (usedDoc) {
      const usedMatches =
        (hasCode && usedDoc.codeHash && (await bcrypt.compare(code, usedDoc.codeHash))) ||
        (hasSecret && usedDoc.secretHash && (await bcrypt.compare(qrSecret, usedDoc.secretHash)));
      if (usedMatches) {
        if (req) await auditLog(req, { action: ACTION_TYPES.ACTIVATION_FAILED, status: "CONFLICT", resourceType: "DeviceActivation", resourceId: usedDoc.activationId, details: "already used" });
        throw new DeviceActivationError(409, "Activation has already been used. Check your device status.");
      }
    }
    if (req) await auditLog(req, { action: ACTION_TYPES.ACTIVATION_FAILED, status: "FAILED", resourceType: "DeviceActivation", details: "invalid or expired" });
    throw new DeviceActivationError(401, "Activation is invalid or expired");
  }

  // Password confirmation (server-side, never logged).
  const passwordMatches = await bcrypt.compare(password, trainer.passwordHash);
  if (!passwordMatches) {
    if (req) await auditLog(req, { action: ACTION_TYPES.ACTIVATION_FAILED, status: "FAILED", resourceType: "DeviceActivation", resourceId: activation.activationId, details: "password mismatch" });
    throw new DeviceActivationError(401, "Activation is invalid or expired");
  }

  // ── Atomic device switch (Mongo transaction REQUIRED) ────────────────
  const session = await mongoose.startSession();
  let registration;
  let apiKey;
  let replacedOld = false;
  try {
    try {
      await session.withTransaction(async () => {
        // 1. Re-consume activation conditionally (single-use, race-safe).
        const consumed = await DeviceActivation.findOneAndUpdate(
          { _id: activation._id, usedAt: null, revokedAt: null },
          { $set: { usedAt: new Date(), usedByBrowserDeviceId: browserDeviceId, usedByMethod: method } },
          { session, new: true }
        );
        if (!consumed) {
          throw new DeviceActivationError(409, "Activation has already been used. Check your device status.");
        }

        // 2. Resolve Kiosk (Case A–D) inside the transaction.
        let kiosk = await Kiosk.findOne({ kioskId: browserDeviceId }).session(session);
        if (!kiosk) {
          // Case A: create with activation scope + enabled=true.
          kiosk = await Kiosk.create([{
            kioskId: browserDeviceId,
            scope: activation.scope,
            enabled: true,
            activeRegistrationCount: 0,
            createdBy: trainer._id,
          }], { session });
          kiosk = kiosk[0];
        } else if (!kiosk.enabled) {
          // Case C: disabled — NEVER re-enable.
          throw new DeviceActivationError(409, "Attendance device is disabled");
        } else if (kiosk.scope !== activation.scope) {
          // Case D: scope mismatch — NEVER overwrite.
          throw new DeviceActivationError(409, "Attendance device scope conflict");
        }
        // Case B: reuse compatible Kiosk (no mutation).

        // 3. INVARIANT B: one active Trainer owner per browserDeviceId/Kiosk.
        const otherOwner = await DeviceRegistration.findOne({
          kioskId: browserDeviceId,
          active: true,
          trainerId: { $ne: trainer._id },
        }).session(session);
        if (otherOwner) {
          throw new DeviceActivationError(409, "This attendance device is in use by another trainer");
        }

        // 4. INVARIANT A: deactivate the Trainer's old active device (if any).
        const old = await DeviceRegistration.findOne({
          trainerId: trainer._id,
          active: true,
        }).session(session);
        if (old) {
          old.active = false;
          old.deactivatedAt = new Date();
          old.apiKeyHash = undefined;
          old.keyFingerprint = undefined;
          await old.save({ session });
          replacedOld = true;
          // Decrement the OLD Kiosk counter (same or different kiosk).
          await Kiosk.updateOne(
            { kioskId: old.kioskId, activeRegistrationCount: { $gt: 0 } },
            { $inc: { activeRegistrationCount: -1 } },
            { session }
          );
        }

        // 5. Create the new registration with a fresh credential.
        apiKey = crypto.randomBytes(32).toString("base64url");
        const keyFingerprint = crypto.createHash("sha256").update(apiKey).digest("hex");
        const fresh = await DeviceRegistration.create([{
          registrationId: crypto.randomUUID(),
          kioskId: browserDeviceId,
          trainerId: trainer._id,
          browserDeviceId,
          active: true,
          activatedAt: new Date(),
          apiKeyHash: await bcrypt.hash(apiKey, 10),
          keyFingerprint,
        }], { session });
        registration = fresh[0].toObject();

        // 6. Increment the NEW Kiosk counter.
        await Kiosk.updateOne(
          { kioskId: browserDeviceId },
          { $inc: { activeRegistrationCount: 1 } },
          { session }
        );
      });
    } catch (err) {
      if (err instanceof DeviceActivationError) throw err;
      if (transactionUnsupported(err)) {
        if (req) await auditLog(req, { action: ACTION_TYPES.ACTIVATION_FAILED, status: "BLOCKED", resourceType: "DeviceActivation", resourceId: activation.activationId, details: "transactions unavailable" });
        throw new DeviceActivationError(503, "Attendance device activation is temporarily unavailable. Please try again later.");
      }
      throw err;
    } finally {
      await session.endSession();
    }
  } catch (err) {
    if (err instanceof DeviceActivationError) throw err;
    if (err?.code === 11000) {
      throw new DeviceActivationError(409, "Attendance device ownership conflict");
    }
    logger.error("Activation redemption failed", { error: err.message });
    throw new DeviceActivationError(503, "Attendance device activation failed. Please try again later.");
  }

  // Success — audit after commit.
  if (req) {
    await auditLog(req, {
      action: ACTION_TYPES.ACTIVATION_REDEEMED,
      status: "SUCCESS",
      resourceType: "DeviceActivation",
      resourceId: activation.activationId,
      changes: {
        trainerId: String(trainer._id),
        kioskId: browserDeviceId,
        scope: activation.scope,
        method,
        replacedOld,
      },
    });
  }

  return {
    registration: {
      registrationId: registration.registrationId,
      kioskId: registration.kioskId,
      trainerId: String(registration.trainerId),
      scope: activation.scope,
      active: registration.active,
      activatedAt: registration.activatedAt,
    },
    apiKey,
  };
}
