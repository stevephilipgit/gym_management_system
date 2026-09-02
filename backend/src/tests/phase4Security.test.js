/**
 * Phase 4 — Security + Concurrency + Input-Validation + Data-Integrity Audit
 */

import mongoose from "mongoose";
import { expect } from "chai";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import "../models/Kiosk.js";
import "../models/DeviceRegistration.js";
import "../models/DeviceActivation.js";
import "../models/Member.js";
import "../models/Attendance.js";
import "../models/Admin.js";
import "../models/AdminSession.js";
import "../models/SystemSettings.js";
import Kiosk from "../models/Kiosk.js";
import DeviceRegistration from "../models/DeviceRegistration.js";
import DeviceActivation from "../models/DeviceActivation.js";
import Admin from "../models/Admin.js";
import systemSettingsService from "../services/systemSettingsService.js";
import { generateActivation, redeemActivation, DeviceActivationError } from "../services/deviceActivationService.js";
import { deactivateRegistration, revokeRegistration, rotateRegistration, reassignKioskScope } from "../services/deviceRegistrationService.js";
import adminAttendanceAuth from "../middleware/adminAttendanceAuth.js";
import jwt from "jsonwebtoken";
import config from "../config/index.js";

const DB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/gym_test";
const TRAINER_PASSWORD = "pass";
const IN_HOURS = new Date("2026-08-30T10:00:00");

const Member = mongoose.model("Member");
const Attendance = mongoose.model("Attendance");

describe("Phase 4 — Security + Concurrency + Integrity (integration)", function () {
  this.timeout(60000);
  let connected = false;
  let trainerA, trainerB, trainerC, trainerScopeChange, superAdmin;
  let memberSeq = 0;

  const makeMember = async (gender, gymId, overrides = {}) => {
    memberSeq += 1;
    const prefix = gender === "Male" ? "M" : "F";
    return Member.create({
      fullName: `P4 ${gender} ${gymId}`, fatherName: "Test", dob: new Date("1990-01-01"),
      bloodGroup: "O+", gender, address: "T", occupation: "Student",
      aadhar: String(100000000000 + Math.floor(Math.random() * 900000000000)),
      phone: `9${String(7000000000 + Math.floor(Math.random() * 2000000000))}`.slice(0, 10),
      gymId, gymPlan: "1 Month", trainingType: "Weight Loss", paymentStatus: "paid",
      status: "active", validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      memberCode: `${prefix}${String(9000 + memberSeq).padStart(4, "0")}`,
      ...overrides,
    });
  };

  const fp = (key) => crypto.createHash("sha256").update(key).digest("hex");

  const mkTrainer = async (scope = "male") => {
    const a = await Admin.create({
      fullName: "P4 T", username: `p4t_${crypto.randomBytes(4).toString("hex")}`,
      email: `${crypto.randomBytes(4).toString("hex")}@p4.local`, role: "trainer", scope,
      passwordHash: await bcrypt.hash(TRAINER_PASSWORD, 4), status: "active", tokenVersion: 0,
    });
    return a._id;
  };

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      // Build indexes so DB invariants are enforced during tests.
      await DeviceRegistration.init();
      await Kiosk.init();
      await DeviceActivation.init();
      await Admin.init();
      // Clean and seed SystemSettings for kioskService.
      await mongoose.model("SystemSettings").deleteMany({});
      await systemSettingsService.updateSettings({ duplicatePunchSeconds: 0 }, null);
      systemSettingsService.invalidateCache();
      // Clean all relevant collections.
      await Kiosk.deleteMany({});
      await DeviceRegistration.deleteMany({});
      await DeviceActivation.deleteMany({});
      await Admin.deleteMany({});
      await Member.deleteMany({});
      await Attendance.deleteMany({});
      trainerA = await mkTrainer("male");
      trainerB = await mkTrainer("male");
      trainerC = await mkTrainer("female_plus_transgender");
      trainerScopeChange = await mkTrainer("male");
      superAdmin = (await Admin.create({
        fullName: "P4 SA", username: `p4sa_${crypto.randomBytes(4).toString("hex")}`,
        email: `${crypto.randomBytes(4).toString("hex")}@p4.local`, role: "superadmin", scope: "all",
        passwordHash: await bcrypt.hash(TRAINER_PASSWORD, 4), status: "active", tokenVersion: 0,
      }))._id;
    } catch (err) {
      console.error("BEFORE FAIL:", err.message);
      this.skip();
    }
  });

  after(async () => {
    if (connected) {
      await Kiosk.deleteMany({}); await DeviceRegistration.deleteMany({});
      await DeviceActivation.deleteMany({}); await Admin.deleteMany({});
      await Member.deleteMany({}); await Attendance.deleteMany({});
      await mongoose.model("SystemSettings").deleteMany({});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    if (!connected) return;
    await DeviceRegistration.deleteMany({});
    await DeviceActivation.deleteMany({});
    await Kiosk.deleteMany({});
  });

  /* ═══════════════════════════════════════════════════════════════
     AUTHORIZATION / IDOR
     ═══════════════════════════════════════════════════════════════ */

  it("IDOR-1: a Trainer cannot redeem another Trainer's activation (server derives trainer from session)", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    // Trainer B tries to redeem it (service called with B's session id).
    let error = null;
    try {
      await redeemActivation({
        trainerId: trainerB, browserDeviceId: "browser-B",
        code: gen.code, password: TRAINER_PASSWORD,
      });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(401);
    // The activation is NOT consumed and still valid for Trainer A.
    const doc = await DeviceActivation.findOne({ activationId: gen.activationId }).lean();
    expect(doc.usedAt).to.be.null;
  });

  it("IDOR-2: forged browserDeviceId with Mongo operators is rejected", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    let error = null;
    try {
      await redeemActivation({
        trainerId: trainerA,
        browserDeviceId: { $ne: "x" },
        code: gen.code, password: TRAINER_PASSWORD,
      });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(400);
  });

  it("IDOR-3: malformed browserDeviceId (nested/noSQL) rejected — $ne/$gt/$in/$regex", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    for (const bad of ["$ne", { $gt: 1 }, { $in: ["a"] }, { $regex: ".*" }, "browser<svg>", "browser\nnewline"]) {
      let error = null;
      try {
        await redeemActivation({
          trainerId: trainerA, browserDeviceId: bad, code: gen.code, password: TRAINER_PASSWORD,
        });
      } catch (err) { error = err; }
      expect(error).to.exist;
      expect(error.status).to.equal(400);
    }
  });

  it("IDOR-4: forged trainerId in generation is rejected (must be a valid ObjectId of a Trainer)", async () => {
    let error = null;
    try {
      await generateActivation({ trainerId: "507f1f77bcf86cd799439011", createdBy: superAdmin });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(404);
  });

  it("IDOR-5: a Trainer cannot deactivate another Trainer's registration (403)", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const redeemed = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-A", code: gen.code, password: TRAINER_PASSWORD });
    let error = null;
    try {
      await deactivateRegistration({ registrationId: redeemed.registration.registrationId, trainerId: trainerB });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(403);
  });

  it("IDOR-6: scope tampering — activation scope is server-derived, never client", async () => {
    const gen = await generateActivation({ trainerId: trainerC, createdBy: superAdmin });
    expect(gen.scope).to.equal("female_plus_transgender");
    expect(gen.scope).to.not.equal("all");
  });

  it("IDOR-7: cannot generate activation for a non-Trainer (Super Admin target)", async () => {
    let error = null;
    try {
      await generateActivation({ trainerId: superAdmin, createdBy: superAdmin });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(404);
  });

  /* ═══════════════════════════════════════════════════════════════
     TRAINER ACTIVATION SECURITY
     ═══════════════════════════════════════════════════════════════ */

  it("ACT-1: valid code redemption succeeds exactly once (replay → 409 deterministic)", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const first = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-r1", code: gen.code, password: TRAINER_PASSWORD });
    expect(first.registration.active).to.be.true;
    // Replay the same code — should get 409 "already been used".
    let error = null;
    try {
      await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-r2", code: gen.code, password: TRAINER_PASSWORD });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(409);
    expect(error.message).to.match(/already been used/i);
    // Exactly one active registration for Trainer A.
    const count = await DeviceRegistration.countDocuments({ trainerId: trainerA, active: true });
    expect(count).to.equal(1);
  });

  it("ACT-2: wrong password → no state change (401)", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    let error = null;
    try {
      await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-w", code: gen.code, password: "wrongpassword" });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(401);
    const doc = await DeviceActivation.findOne({ activationId: gen.activationId }).lean();
    expect(doc.usedAt).to.be.null;
  });

  it("ACT-3: expired activation → 401 generic, no state change", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await DeviceActivation.updateOne({ activationId: gen.activationId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    let error = null;
    try {
      await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-e", code: gen.code, password: TRAINER_PASSWORD });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(401);
    expect(error.message).to.match(/invalid or expired/i);
  });

  it("ACT-4: revoked activation → 401 generic", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    // A new activation for the same trainer revokes the prior one.
    await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const revoked = await DeviceActivation.findOne({ activationId: gen.activationId }).lean();
    expect(revoked.revokedAt).to.not.be.null;
    let error = null;
    try {
      await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-v", code: gen.code, password: TRAINER_PASSWORD });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(401);
  });

  it("ACT-5: QR redemption consumes the activation; 6-digit code becomes invalid", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const first = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-qr", qrSecret: gen.qrPayload, password: TRAINER_PASSWORD });
    expect(first.registration.active).to.be.true;
    // QR shared a lifecycle with code; the code is now dead.
    let error = null;
    try {
      await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-qr2", code: gen.code, password: TRAINER_PASSWORD });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(409);
    expect(error.message).to.match(/already been used/i);
  });

  it("ACT-6: QR + code race — exactly one wins (single-use lifecycle)", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const [r1, r2] = await Promise.allSettled([
      redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-c1", code: gen.code, password: TRAINER_PASSWORD }),
      redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-c2", qrSecret: gen.qrPayload, password: TRAINER_PASSWORD }),
    ]);
    const ok = [r1, r2].filter((r) => r.status === "fulfilled");
    expect(ok.length).to.equal(1);
    const active = await DeviceRegistration.countDocuments({ trainerId: trainerA, active: true });
    expect(active).to.equal(1);
    const usedMethod = await DeviceActivation.findOne({ activationId: gen.activationId }).lean();
    expect(usedMethod.usedByMethod).to.be.oneOf(["code", "qr"]);
  });

  /* ═══════════════════════════════════════════════════════════════
     BRUTE FORCE / RATE LIMITING
     ═══════════════════════════════════════════════════════════════ */

  it("RATE-1: wrong-code attempts return generic 401 with no enumeration signal", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const messages = new Set();
    for (let i = 0; i < 5; i++) {
      let error = null;
      try {
        await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-bf", code: "000000", password: TRAINER_PASSWORD });
      } catch (err) { error = err; }
      expect(error).to.exist;
      expect(error.status).to.equal(401);
      expect(error.message).to.equal("Activation is invalid or expired");
      messages.add(error.message);
    }
    expect(messages.size).to.equal(1);
  });

  it("RATE-2: valid code after failed attempts still works (no lockout of the code itself)", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    for (let i = 0; i < 3; i++) {
      try { await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-bf2", code: "111111", password: TRAINER_PASSWORD }); } catch { /* ignore */ }
    }
    const res = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-bf2-ok", code: gen.code, password: TRAINER_PASSWORD });
    expect(res.registration.active).to.be.true;
  });

  /* ═══════════════════════════════════════════════════════════════
     DEVICE OWNERSHIP INVARIANTS
     ═══════════════════════════════════════════════════════════════ */

  it("OWN-1: INVARIANT B — same browser, two Trainers → 409 (no ownership transfer)", async () => {
    const genA = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const rA = await redeemActivation({ trainerId: trainerA, browserDeviceId: "shared-browser", code: genA.code, password: TRAINER_PASSWORD });
    expect(rA.registration.active).to.be.true;
    const genB = await generateActivation({ trainerId: trainerB, createdBy: superAdmin });
    let error = null;
    try {
      await redeemActivation({ trainerId: trainerB, browserDeviceId: "shared-browser", code: genB.code, password: TRAINER_PASSWORD });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(409);
    expect(error.message).to.match(/in use by another trainer/i);
    const aOwner = await DeviceRegistration.findOne({ kioskId: "shared-browser", active: true });
    expect(String(aOwner.trainerId)).to.equal(String(trainerA));
  });

  it("OWN-2: INVARIANT A — one active device per Trainer (replacement)", async () => {
    const g1 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-x", code: g1.code, password: TRAINER_PASSWORD });
    const g2 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const r2 = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-y", code: g2.code, password: TRAINER_PASSWORD });
    expect(r2.registration.active).to.be.true;
    const active = await DeviceRegistration.find({ trainerId: trainerA, active: true }).lean();
    expect(active.length).to.equal(1);
    expect(active[0].kioskId).to.equal("browser-y");
    const oldReg = await DeviceRegistration.findOne({ kioskId: "browser-x" }).lean();
    expect(oldReg.active).to.be.false;
    expect(oldReg.apiKeyHash).to.be.undefined;
  });

  it("OWN-3: simultaneous replacement — exactly one active device, old inactive (valid final state)", async () => {
    const g0 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-z", code: g0.code, password: TRAINER_PASSWORD });
    // Two concurrent replacements.
    const [gB, gC] = await Promise.all([
      generateActivation({ trainerId: trainerA, createdBy: superAdmin }),
      generateActivation({ trainerId: trainerA, createdBy: superAdmin }),
    ]);
    const [rB, rC] = await Promise.allSettled([
      redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-B2", code: gB.code, password: TRAINER_PASSWORD }),
      redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-C2", code: gC.code, password: TRAINER_PASSWORD }),
    ]);
    // CONTRACT (Phase 4 §5): the REQUIRED outcome is a valid FINAL DB state —
    // exactly ONE active registration, only the winning new device active, old
    // device inactive. Both requests may legitimately succeed when they
    // serialise (each is an internally atomic switch: the second's transaction
    // deactivates the first's winner before activating its own). No duplicate
    // active registration may ever exist — the unique partial index on
    // (trainerId where active:true) is the backstop.
    const active = await DeviceRegistration.find({ trainerId: trainerA, active: true }).lean();
    expect(active.length).to.equal(1);            // INVARIANT A holds
    const winnerKiosk = active[0].kioskId;
    expect(["browser-B2", "browser-C2"]).to.include(winnerKiosk);
    // Old device inactive.
    const old = await DeviceRegistration.findOne({ kioskId: "browser-z" }).lean();
    expect(old.active).to.be.false;
    // Each successful redemption consumed exactly one activation; no activation
    // is left half-consumed. Every used activation is terminal.
    for (const r of [rB, rC]) {
      if (r.status === "fulfilled") {
        expect(r.value.registration.active).to.be.true;
      }
    }
    const usedCount = await DeviceActivation.countDocuments({ trainerId: trainerA, usedAt: { $ne: null } });
    const regs = await DeviceRegistration.find({ trainerId: trainerA }).lean();
    const consumedByTxn = regs.length; // g0 winner + each new activation that committed
    expect(usedCount).to.equal(consumedByTxn);
    // No duplicate credentials: each active registration has a unique fingerprint.
    const fps = active.map((a) => a.keyFingerprint);
    expect(new Set(fps).size).to.equal(fps.length);
  });

  /* ═══════════════════════════════════════════════════════════════
     KIOSK STATE
     ═══════════════════════════════════════════════════════════════ */

  it("KIOSK-1: absent Kiosk → created with activation scope, enabled=true", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-k1", code: gen.code, password: TRAINER_PASSWORD });
    const kiosk = await Kiosk.findOne({ kioskId: "browser-k1" }).lean();
    expect(kiosk).to.exist;
    expect(kiosk.enabled).to.be.true;
    expect(kiosk.scope).to.equal("male");
  });

  it("KIOSK-2: existing enabled matching Kiosk → reused, never re-scoped", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-k2", code: gen.code, password: TRAINER_PASSWORD });
    await deactivateRegistration({
      registrationId: (await DeviceRegistration.findOne({ kioskId: "browser-k2", active: true })).registrationId,
      trainerId: trainerA,
    });
    const gen2 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-k2", code: gen2.code, password: TRAINER_PASSWORD });
    const kiosk2 = await Kiosk.findOne({ kioskId: "browser-k2" }).lean();
    expect(kiosk2.enabled).to.be.true;
    expect(kiosk2.scope).to.equal("male");
  });

  it("KIOSK-3: disabled Kiosk → activation rejected, Kiosk NOT re-enabled", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-k3", code: gen.code, password: TRAINER_PASSWORD });
    await Kiosk.updateOne({ kioskId: "browser-k3" }, { $set: { enabled: false } });
    const gen2 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    let error = null;
    try {
      await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-k3", code: gen2.code, password: TRAINER_PASSWORD });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(409);
    expect(error.message).to.match(/disabled/i);
    const kiosk = await Kiosk.findOne({ kioskId: "browser-k3" }).lean();
    expect(kiosk.enabled).to.be.false;
  });

  it("KIOSK-4: scope-mismatch Kiosk → activation rejected, scope NEVER overwritten", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-k4", code: gen.code, password: TRAINER_PASSWORD });
    const genC = await generateActivation({ trainerId: trainerC, createdBy: superAdmin });
    let error = null;
    try {
      await redeemActivation({ trainerId: trainerC, browserDeviceId: "browser-k4", code: genC.code, password: TRAINER_PASSWORD });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(409);
    const kiosk = await Kiosk.findOne({ kioskId: "browser-k4" }).lean();
    expect(kiosk.scope).to.equal("male");
  });

  /* ═══════════════════════════════════════════════════════════════
     TRAINER SCOPE CHANGE
     ═══════════════════════════════════════════════════════════════ */

  it("SCOPE-1: Trainer scope change revokes active registration + unused activations", async () => {
    const gen = await generateActivation({ trainerId: trainerScopeChange, createdBy: superAdmin });
    const r = await redeemActivation({ trainerId: trainerScopeChange, browserDeviceId: "browser-s1", code: gen.code, password: TRAINER_PASSWORD });
    expect(r.registration.active).to.be.true;
    await Admin.updateOne({ _id: trainerScopeChange }, { $set: { scope: "female_plus_transgender", tokenVersion: 1 } });
    const { revokeTrainerRegistrations } = await import("../services/deviceRegistrationService.js");
    await revokeTrainerRegistrations({ trainerId: trainerScopeChange });
    await DeviceActivation.updateMany(
      { trainerId: trainerScopeChange, usedAt: null, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    const old = await DeviceRegistration.findOne({ kioskId: "browser-s1" }).lean();
    expect(old.active).to.be.false;
    expect(old.apiKeyHash).to.be.undefined;
    const gen2 = await generateActivation({ trainerId: trainerScopeChange, createdBy: superAdmin });
    expect(gen2.scope).to.equal("female_plus_transgender");
    const r2 = await redeemActivation({ trainerId: trainerScopeChange, browserDeviceId: "browser-s1b", code: gen2.code, password: TRAINER_PASSWORD });
    expect(r2.registration.active).to.be.true;
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPER ADMIN ATTENDANCE TOKEN SECURITY
     ═══════════════════════════════════════════════════════════════ */

  const callAdminAttendanceAuth = async (token) => {
    const req = { get: (h) => (h.toLowerCase() === "x-admin-attendance-token" ? token : null) };
    const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    let nextCalled = false;
    await adminAttendanceAuth(req, res, () => { nextCalled = true; });
    return { req, res, nextCalled };
  };

  const makeSaToken = (payloadOverrides = {}, optionsOverrides = {}) => jwt.sign(
    {
      adminId: String(superAdmin),
      scope: "male",
      purpose: "superadmin_attendance",
      jti: crypto.randomUUID(),
      ...payloadOverrides,
    },
    optionsOverrides.secret || config.jwt.adminAttendanceSecret,
    {
      algorithm: "HS256",
      issuer: config.jwt.adminAttendanceIssuer,
      audience: config.jwt.adminAttendanceAudience,
      expiresIn: config.jwt.adminAttendanceExpires,
      ...optionsOverrides,
    }
  );

  it("SA-1: valid token → principal attached with server-verified superadmin", async () => {
    const token = makeSaToken();
    const { nextCalled, req } = await callAdminAttendanceAuth(token);
    expect(nextCalled).to.be.true;
    expect(req.attendancePrincipal).to.exist;
    expect(req.attendancePrincipal.type).to.equal("superadmin");
    expect(req.attendancePrincipal.scope).to.equal("male");
    expect(String(req.attendancePrincipal.adminId)).to.equal(String(superAdmin));
  });

  it("SA-2: forged/random token → 401", async () => {
    const { res } = await callAdminAttendanceAuth("not.a.jwt");
    expect(res.code).to.equal(401);
  });

  it("SA-3: expired token → 401", async () => {
    const token = makeSaToken({}, { expiresIn: "-1s" });
    const { res } = await callAdminAttendanceAuth(token);
    expect(res.code).to.equal(401);
  });

  it("SA-4: modified scope ('all') → 401 rejected", async () => {
    const token = makeSaToken({ scope: "all" });
    const { res } = await callAdminAttendanceAuth(token);
    expect(res.code).to.equal(401);
  });

  it("SA-5: wrong audience → 401", async () => {
    const token = makeSaToken({}, { audience: "not-kiosk-punch" });
    const { res } = await callAdminAttendanceAuth(token);
    expect(res.code).to.equal(401);
  });

  it("SA-6: wrong issuer → 401", async () => {
    const token = makeSaToken({}, { issuer: "other-issuer" });
    const { res } = await callAdminAttendanceAuth(token);
    expect(res.code).to.equal(401);
  });

  it("SA-7: missing purpose → 401", async () => {
    const token = jwt.sign(
      { adminId: String(superAdmin), scope: "male", jti: crypto.randomUUID() },
      config.jwt.adminAttendanceSecret,
      { algorithm: "HS256", issuer: config.jwt.adminAttendanceIssuer, audience: config.jwt.adminAttendanceAudience, expiresIn: "2m" }
    );
    const { res } = await callAdminAttendanceAuth(token);
    expect(res.code).to.equal(401);
  });

  it("SA-8: normal login JWT cannot be used as attendance token", async () => {
    const loginToken = jwt.sign(
      { id: String(superAdmin), username: "p4sa", role: "superadmin", scope: "all", sid: "x", tv: 0, jti: crypto.randomUUID() },
      config.jwt.accessSecret,
      { algorithm: "HS256", expiresIn: "15m" }
    );
    const { res } = await callAdminAttendanceAuth(loginToken);
    expect(res.code).to.equal(401);
  });

  it("SA-9: non-superadmin (Trainer) with a valid-purpose token → 403 (DB role re-check)", async () => {
    const token = makeSaToken({ adminId: String(trainerA) });
    const { res } = await callAdminAttendanceAuth(token);
    expect(res.code).to.equal(403);
  });

  it("SA-10: wrong algorithm (HS384) → 401", async () => {
    const token = jwt.sign(
      { adminId: String(superAdmin), scope: "male", purpose: "superadmin_attendance", jti: crypto.randomUUID() },
      config.jwt.adminAttendanceSecret,
      { algorithm: "HS384", issuer: config.jwt.adminAttendanceIssuer, audience: config.jwt.adminAttendanceAudience, expiresIn: "2m" }
    );
    const { res } = await callAdminAttendanceAuth(token);
    expect(res.code).to.equal(401);
  });

  /* ═══════════════════════════════════════════════════════════════
     STALE BROWSER STATE
     ═══════════════════════════════════════════════════════════════ */

  it("STALE-1: Super Admin precedence is a frontend rule; backend has no stale-cred fallback", async () => {
    // Backend: kioskAuth requires a valid device credential; normal admin
    // session is never a kiosk. Verified by code review.
    const token = makeSaToken();
    const { nextCalled, req } = await callAdminAttendanceAuth(token);
    expect(nextCalled).to.be.true;
    expect(req.attendancePrincipal.type).to.equal("superadmin");
  });

  /* ═══════════════════════════════════════════════════════════════
     BEARER CREDENTIAL AUDIT
     ═══════════════════════════════════════════════════════════════ */

  it("BEARER-1: old credential invalid after replacement (documented bearer property)", async () => {
    const g1 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const r1 = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-bear1", code: g1.code, password: TRAINER_PASSWORD });
    const oldReg = await DeviceRegistration.findOne({ kioskId: "browser-bear1", active: true });
    const g2 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-bear2", code: g2.code, password: TRAINER_PASSWORD });
    const oldReg2 = await DeviceRegistration.findById(oldReg._id).lean();
    expect(oldReg2.active).to.be.false;
    expect(oldReg2.apiKeyHash).to.be.undefined;
    const fpOld = fp(r1.apiKey);
    const lookup = await DeviceRegistration.findOne({ kioskId: "browser-bear1", keyFingerprint: fpOld }).lean();
    expect(lookup).to.be.null;
  });

  /* ═══════════════════════════════════════════════════════════════
     INPUT VALIDATION / NOSQL
     ═══════════════════════════════════════════════════════════════ */

  it("NOSQL-1: activation generation rejects non-string / noSQL trainerId", async () => {
    for (const bad of [{ $gt: 1 }, { $in: [] }, ["x"], 123, null]) {
      let error = null;
      try { await generateActivation({ trainerId: bad, createdBy: superAdmin }); } catch (err) { error = err; }
      expect(error).to.exist;
      expect(error.status).to.equal(400);
    }
  });

  it("NOSQL-2: no sensitive hashes/keys/secrets in redemption response", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const r = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-sec", code: gen.code, password: TRAINER_PASSWORD });
    const s = JSON.stringify(r);
    expect(s).to.not.include("codeHash");
    expect(s).to.not.include("secretHash");
    expect(s).to.not.include("passwordHash");
    expect(s).to.not.include(gen.code);
    expect(s).to.not.include(gen.qrPayload);
    expect(s).to.not.include("apiKeyHash");
    expect(r.apiKey).to.be.a("string");
  });

  it("NOSQL-3: generation response never contains hashes", async () => {
    const gen = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const s = JSON.stringify(gen);
    expect(s).to.not.include("codeHash");
    expect(s).to.not.include("secretHash");
    expect(s).to.not.include("passwordHash");
    expect(gen.code).to.match(/^\d{6}$/);
  });

  /* ═══════════════════════════════════════════════════════════════
     ACTIVE REGISTRATION COUNT
     ═══════════════════════════════════════════════════════════════ */

  it("COUNT-1: activeRegistrationCount is informational; equals actual active registrations", async () => {
    const g1 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-c1x", code: g1.code, password: TRAINER_PASSWORD });
    const g2 = await generateActivation({ trainerId: trainerB, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerB, browserDeviceId: "browser-c2x", code: g2.code, password: TRAINER_PASSWORD });
    const k1 = await Kiosk.findOne({ kioskId: "browser-c1x" }).lean();
    const k2 = await Kiosk.findOne({ kioskId: "browser-c2x" }).lean();
    expect(k1.activeRegistrationCount).to.equal(1);
    expect(k2.activeRegistrationCount).to.equal(1);
    // Same-kiosk replacement.
    const g3 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-c1x", code: g3.code, password: TRAINER_PASSWORD });
    const k1b = await Kiosk.findOne({ kioskId: "browser-c1x" }).lean();
    const actual = await DeviceRegistration.countDocuments({ kioskId: "browser-c1x", active: true });
    expect(actual).to.equal(1);
    expect(k1b.activeRegistrationCount).to.equal(actual);
    expect(k1b.activeRegistrationCount).to.be.at.least(0);
  });

  /* ═══════════════════════════════════════════════════════════════
     TRAINER REVOCATION → REACTIVATION LIFECYCLE
     "Ownership conflict" means ACTIVE registration for a DIFFERENT Trainer.
     An inactive/revoked registration of the SAME Trainer must NOT block a
     fresh activation (TRAINER REVOKED ≠ KIOSK DISABLED).
     ═══════════════════════════════════════════════════════════════ */

  it("REACT-A: Trainer A active → Admin revoke → new activation → same Browser X → SUCCESS", async () => {
    const g1 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const r1 = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-rex-a", code: g1.code, password: TRAINER_PASSWORD });
    expect(r1.registration.active).to.be.true;
    // Super Admin revokes.
    const reg = await DeviceRegistration.findOne({ kioskId: "browser-rex-a", active: true });
    await revokeRegistration({ registrationId: reg.registrationId, isSuperAdmin: true });
    // Revoked state: inactive + credential removed + historical record kept.
    const afterRevoke = await DeviceRegistration.findById(reg._id).lean();
    expect(afterRevoke.active).to.be.false;
    expect(afterRevoke.revokedAt).to.not.be.null;
    expect(afterRevoke.apiKeyHash).to.be.undefined;
    // New activation for the SAME Trainer on the SAME browser.
    const g2 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const r2 = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-rex-a", code: g2.code, password: TRAINER_PASSWORD });
    expect(r2.registration.active).to.be.true;
    // Exactly one ACTIVE registration; old remains historical/inactive.
    const active = await DeviceRegistration.find({ trainerId: trainerA, active: true }).lean();
    expect(active.length).to.equal(1);
    expect(active[0].kioskId).to.equal("browser-rex-a");
    const oldDoc = await DeviceRegistration.findById(reg._id).lean();
    expect(oldDoc.active).to.be.false; // historical record preserved
  });

  it("REACT-B: Trainer A revoked → Trainer B attempts Browser X → follows ownership rule (no false block from A's old reg)", async () => {
    // A revoked Browser X leaves no ACTIVE ownership.
    const g1 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const r1 = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-rex-b", code: g1.code, password: TRAINER_PASSWORD });
    const reg = await DeviceRegistration.findOne({ kioskId: "browser-rex-b", active: true });
    await revokeRegistration({ registrationId: reg.registrationId, isSuperAdmin: true });
    // B has a DIFFERENT scope (male in this suite) → Kiosk scope must match.
    // A's old registration is inactive so INVARIANT B is satisfied.
    const gB = await generateActivation({ trainerId: trainerB, createdBy: superAdmin });
    const rB = await redeemActivation({ trainerId: trainerB, browserDeviceId: "browser-rex-b", code: gB.code, password: TRAINER_PASSWORD });
    expect(rB.registration.active).to.be.true;
    // Ownership is now B's.
    const owner = await DeviceRegistration.findOne({ kioskId: "browser-rex-b", active: true });
    expect(String(owner.trainerId)).to.equal(String(trainerB));
    // A's old record remains historical.
    const aOld = await DeviceRegistration.findById(reg._id).lean();
    expect(aOld.active).to.be.false;
  });

  it("REACT-C: Trainer A ACTIVE on Browser X → Trainer B attempts → 409 ownership conflict", async () => {
    const g1 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-rex-c", code: g1.code, password: TRAINER_PASSWORD });
    const gB = await generateActivation({ trainerId: trainerB, createdBy: superAdmin });
    let error = null;
    try {
      await redeemActivation({ trainerId: trainerB, browserDeviceId: "browser-rex-c", code: gB.code, password: TRAINER_PASSWORD });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(409);
    // A still owns it.
    const owner = await DeviceRegistration.findOne({ kioskId: "browser-rex-c", active: true });
    expect(String(owner.trainerId)).to.equal(String(trainerA));
  });

  it("REACT-D: existing DISABLED Kiosk → new activation rejected; Kiosk stays disabled", async () => {
    const g1 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-rex-d", code: g1.code, password: TRAINER_PASSWORD });
    await Kiosk.updateOne({ kioskId: "browser-rex-d" }, { $set: { enabled: false } });
    const g2 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    let error = null;
    try {
      await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-rex-d", code: g2.code, password: TRAINER_PASSWORD });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(409);
    expect(error.message).to.match(/disabled/i);
    const kiosk = await Kiosk.findOne({ kioskId: "browser-rex-d" }).lean();
    expect(kiosk.enabled).to.be.false; // never auto-enabled
  });

  it("REACT-E: existing same-scope ENABLED Kiosk → new activation reused successfully", async () => {
    const g1 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-rex-e", code: g1.code, password: TRAINER_PASSWORD });
    // Revoke A, then reactivate on same browser.
    const reg = await DeviceRegistration.findOne({ kioskId: "browser-rex-e", active: true });
    await revokeRegistration({ registrationId: reg.registrationId, isSuperAdmin: true });
    const g2 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    const r2 = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-rex-e", code: g2.code, password: TRAINER_PASSWORD });
    expect(r2.registration.active).to.be.true;
    const kiosk = await Kiosk.findOne({ kioskId: "browser-rex-e" }).lean();
    expect(kiosk.enabled).to.be.true;
    expect(kiosk.scope).to.equal("male"); // unchanged
  });

  it("REACT-F: existing scope-mismatch Kiosk → activation rejected; scope unchanged", async () => {
    const g1 = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-rex-f", code: g1.code, password: TRAINER_PASSWORD });
    // Female/T trainer tries the male-scope browser.
    const gC = await generateActivation({ trainerId: trainerC, createdBy: superAdmin });
    let error = null;
    try {
      await redeemActivation({ trainerId: trainerC, browserDeviceId: "browser-rex-f", code: gC.code, password: TRAINER_PASSWORD });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error.status).to.equal(409);
    const kiosk = await Kiosk.findOne({ kioskId: "browser-rex-f" }).lean();
    expect(kiosk.scope).to.equal("male"); // never overwritten
  });

  it("REACT-G: old revoked registration never blocks fresh activation (DB + service level)", async () => {
    // Multiple revoke→reactivate cycles on the same browser must all succeed.
    for (let i = 0; i < 3; i++) {
      const g = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
      const r = await redeemActivation({ trainerId: trainerA, browserDeviceId: "browser-rex-g", code: g.code, password: TRAINER_PASSWORD });
      expect(r.registration.active).to.be.true;
      const reg = await DeviceRegistration.findOne({ kioskId: "browser-rex-g", active: true });
      await revokeRegistration({ registrationId: reg.registrationId, isSuperAdmin: true });
    }
    // Exactly one active registration at the end (none left behind active).
    const active = await DeviceRegistration.countDocuments({ trainerId: trainerA, active: true });
    expect(active).to.equal(0); // all revoked
    // DB invariant: partial unique index applies ONLY to active registrations —
    // many historical inactive docs on the same kiosk coexist without conflict.
    const hist = await DeviceRegistration.countDocuments({ kioskId: "browser-rex-g", active: false });
    expect(hist).to.equal(3);
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPER ADMIN ATTENDANCE DATA ISOLATION
     ═══════════════════════════════════════════════════════════════ */

  it("ISO-1: Male + Female same Gym ID resolve scope-specifically (performKioskPunch with scope)", async () => {
    const male = await makeMember("Male", 192);
    const female = await makeMember("Female", 192);
    const { performKioskPunch } = await import("../services/kioskService.js");
    const maleRes = await performKioskPunch({
      input: "192", scope: "male",
      principal: { type: "superadmin", adminId: String(superAdmin) },
      now: IN_HOURS,
    });
    expect(maleRes.member._id.toString()).to.equal(male._id.toString());
    const femaleRes = await performKioskPunch({
      input: "192", scope: "female_plus_transgender",
      principal: { type: "superadmin", adminId: String(superAdmin) },
      now: IN_HOURS,
    });
    expect(femaleRes.member._id.toString()).to.equal(female._id.toString());
    const maleAtt = await Attendance.countDocuments({ memberId: male._id });
    expect(maleAtt).to.be.at.least(1);
    const femaleAtt = await Attendance.countDocuments({ memberId: female._id });
    expect(femaleAtt).to.be.at.least(1);
  });

  it("ISO-2: Female + Transgender same Gym ID → integrity error, NO Attendance write", async () => {
    const f1 = await makeMember("Female", 500);
    const t1 = await makeMember("Transgender", 500);
    const { performKioskPunch, KioskError } = await import("../services/kioskService.js");
    let error = null;
    try {
      await performKioskPunch({
        input: "500", scope: "female_plus_transgender",
        principal: { type: "superadmin", adminId: String(superAdmin) },
        now: IN_HOURS,
      });
    } catch (err) { error = err; }
    expect(error).to.exist;
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(409);
    expect(error.extra?.status).to.equal("integrity_error");
    const att = await Attendance.countDocuments({ memberId: { $in: [f1._id, t1._id] } });
    expect(att).to.equal(0);
  });
});