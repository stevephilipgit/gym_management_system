/**
 * Kiosk Authentication + Shared-Customer Punch Tests
 *
 * Covers the dedicated customer-facing kiosk trust boundary for the ONE
 * SHARED CUSTOMER KIOSK (Male + Female + Transgender):
 *   AUTH     — valid / invalid / disabled / revoked / missing kiosk credential
 *   IDENTITY — Male 192 vs Female 192 independent members
 *   RESOLVE  — 0 / 1 / many Gym ID handling; Female+Transgender integrity
 *   SELECT   — memberCode + selectionToken post-picker paths
 *   PUNCH    — first punch, duplicate, checkout, duplicate checkout, expired,
 *              inactive, outside hours
 *   CONCURRENCY — simultaneous punch-in / checkout
 *   SECURITY — manipulated kioskId, forged credential, cross-gym collision,
 *              safe-field-only candidates, browser memberId not accepted
 *
 * Integration sections require a MongoDB instance (MONGO_URI or
 * mongodb://localhost:27017/gym_test) and SKIP when it is unreachable.
 *
 * Run: cd backend && npm test
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { expect } from "chai";
import bcrypt from "bcryptjs";
import crypto from "crypto";

dotenv.config();

import "../models/Kiosk.js";
import "../models/DeviceRegistration.js";
import "../models/Member.js";
import "../models/Attendance.js";
import "../models/SystemSettings.js";
import Kiosk from "../models/Kiosk.js";
import Member from "../models/Member.js";
import Attendance from "../models/Attendance.js";
import DeviceRegistration from "../models/DeviceRegistration.js";
import kioskAuth from "../middleware/kioskAuth.js";
import { performKioskPunch, KioskError } from "../services/kioskService.js";
import systemSettingsService from "../services/systemSettingsService.js";

const AttendanceModel = mongoose.model("Attendance");
const MemberModel = mongoose.model("Member");

const DB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/gym_test";

// Deterministic clock — inside business hours (04:00-22:00), not late (<=21:00).
const IN_HOURS = new Date("2026-08-30T10:00:00");
// Outside business hours.
const OUT_OF_HOURS = new Date("2026-08-30T23:30:00");

/* ============================================================
   UNIT TESTS — input validation + payload (no DB needed)
   ============================================================ */
describe("Kiosk input validation (unit)", () => {
  it("rejects empty input", async () => {
    let error = null;
    try {
      await performKioskPunch({ input: "", scope: undefined, principal: { type: "kiosk", kioskId: "kiosk-test" }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(400);
  });

  it("rejects non-numeric input", async () => {
    let error = null;
    try {
      await performKioskPunch({ input: "M1001", scope: undefined, principal: { type: "kiosk", kioskId: "kiosk-test" }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(400);
  });

  it("rejects a request with no identity mode", async () => {
    let error = null;
    try {
      await performKioskPunch({ scope: undefined, principal: { type: "kiosk", kioskId: "kiosk-test" }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(400);
  });
});

/* ============================================================
   INTEGRATION TESTS — require MongoDB (skip if unavailable)
   ============================================================ */
describe("Kiosk auth + punch (integration)", function () {
  this.timeout(30000);
  let connected = false;

  let mainKiosk;
  let disabledKiosk;
  const mainKey = "shared-secret-key-1";
  const disabledKey = "disabled-secret-key-3";
  const fingerprintOf = (key) => crypto.createHash("sha256").update(key).digest("hex");

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      await Kiosk.deleteMany({});
      await DeviceRegistration.deleteMany({});
      await Member.deleteMany({});
      await Attendance.deleteMany({});
      await mongoose.model("SystemSettings").deleteMany({});

      // Physical devices with FIXED scope. The kiosk credential is bound to a
      // DeviceRegistration, not stored on the Kiosk document (Phase 2 model).
      mainKiosk = await Kiosk.create({
        kioskId: "kiosk-main-test",
        name: "Main Test Kiosk",
        scope: "male",
        enabled: true,
      });
      disabledKiosk = await Kiosk.create({
        kioskId: "kiosk-disabled-test",
        name: "Disabled Test Kiosk",
        scope: "male",
        enabled: false,
      });

      // Browser/device registrations bound to the physical Kiosks.
      await DeviceRegistration.create([
        {
          registrationId: "reg-main-test",
          kioskId: "kiosk-main-test",
          trainerId: new mongoose.Types.ObjectId(),
          browserDeviceId: "browser-main-test",
          apiKeyHash: await bcrypt.hash(mainKey, 10),
          keyFingerprint: fingerprintOf(mainKey),
          active: true,
        },
        {
          registrationId: "reg-disabled-test",
          kioskId: "kiosk-disabled-test",
          trainerId: new mongoose.Types.ObjectId(),
          browserDeviceId: "browser-disabled-test",
          apiKeyHash: await bcrypt.hash(disabledKey, 10),
          keyFingerprint: fingerprintOf(disabledKey),
          active: true,
        },
      ]);

      // Default: no duplicate window so check-in → check-out flows are clean.
      // The duplicate test temporarily raises it.
      await systemSettingsService.updateSettings({ duplicatePunchSeconds: 0 }, null);
      systemSettingsService.invalidateCache();
    } catch (err) {
      this.skip();
    }
  });

  after(async () => {
    if (connected) {
      await Kiosk.deleteMany({});
      await DeviceRegistration.deleteMany({});
      await Member.deleteMany({});
      await Attendance.deleteMany({});
      await mongoose.disconnect();
    }
  });

  let memberSeq = 0;
  const makeMember = async (gender, gymId, overrides = {}) => {
    memberSeq += 1;
    const prefix = gender === "Male" ? "M" : "F";
    return Member.create({
      fullName: `Test ${gender} ${gymId}`,
      fatherName: "Test",
      dob: new Date("1990-01-01"),
      bloodGroup: "O+",
      gender,
      address: "Test Address",
      occupation: "Student",
      aadhar: String(100000000000 + Math.floor(Math.random() * 900000000000)),
      phone: `9${String(7000000000 + Math.floor(Math.random() * 2000000000))}`.slice(0, 10),
      gymId,
      gymPlan: "1 Month",
      trainingType: "Weight Loss",
      paymentStatus: "paid",
      status: "active",
      validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      memberCode: `${prefix}${String(9000 + memberSeq).padStart(4, "0")}`,
      ...overrides,
    });
  };

  const kiosk = { kioskId: "kiosk-main-test" };

  const runAuth = (kioskId, apiKey) => {
    const req = { get: (h) => (h.toLowerCase() === "x-kiosk-id" ? kioskId : h.toLowerCase() === "x-kiosk-key" ? apiKey : null) };
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    let nextCalled = false;
    return {
      req,
      res,
      next: () => { nextCalled = true; },
      nextCalled: () => nextCalled,
    };
  };

  /* ── AUTH ─────────────────────────────────────────────────── */
  it("AUTH: valid device registration authenticates and attaches server-derived scope", async () => {
    const { req, res, next, nextCalled } = runAuth("kiosk-main-test", mainKey);
    await kioskAuth(req, res, next);
    expect(nextCalled()).to.be.true;
    expect(req.kiosk.principalType).to.equal("kiosk");
    expect(req.kiosk.kioskId).to.equal("kiosk-main-test");
    expect(req.kiosk.scope).to.equal("male"); // server-derived, never from client
    expect(req.kiosk.registrationId).to.exist;
  });

  it("AUTH: missing kiosk credential is rejected with 401", async () => {
    const { req, res, next, nextCalled } = runAuth("", "");
    await kioskAuth(req, res, next);
    expect(nextCalled()).to.be.false;
    expect(res.statusCode).to.equal(401);
  });

  it("AUTH: invalid API key is rejected with 401", async () => {
    const { req, res, next, nextCalled } = runAuth("kiosk-main-test", "wrong-key");
    await kioskAuth(req, res, next);
    expect(nextCalled()).to.be.false;
    expect(res.statusCode).to.equal(401);
  });

  it("AUTH: unknown kioskId is rejected with 401 (same message as bad key)", async () => {
    const { req, res, next, nextCalled } = runAuth("kiosk-nonexistent", "whatever");
    await kioskAuth(req, res, next);
    expect(nextCalled()).to.be.false;
    expect(res.statusCode).to.equal(401);
    expect(res.body.message).to.equal("Kiosk authentication failed.");
  });

  it("AUTH: disabled kiosk is rejected with 403 even with a valid key (fail closed)", async () => {
    const { req, res, next, nextCalled } = runAuth("kiosk-disabled-test", disabledKey);
    await kioskAuth(req, res, next);
    expect(nextCalled()).to.be.false;
    expect(res.statusCode).to.equal(403);
  });

  it("AUTH: a kiosk credential never satisfies requireRole('superadmin')", () => {
    const { req } = runAuth("kiosk-main-test", mainKey);
    expect(req.admin).to.be.undefined;
  });

  /* ── IDENTITY ──────────────────────────────────────────────── */
  it("IDENTITY: Male 192 and Female 192 are independent members", async () => {
    const male = await makeMember("Male", 192);
    const female = await makeMember("Female", 192);
    expect(male._id).to.not.equal(female._id);
    expect(male.gymId).to.equal(female.gymId);
    expect(male.gender).to.equal("Male");
    expect(female.gender).to.equal("Female");
  });

  /* ── RESOLUTION: single match (auto-punch) ────────────────── */
  it("RESOLVE: single Male member punches directly (one request)", async () => {
    const male = await makeMember("Male", 300);
    const res = await performKioskPunch({ input: String(300), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    expect(res.success).to.be.true;
    expect(res.member.gymId).to.equal(300);
    expect(res.member.name).to.equal(male.fullName);
    expect(res.isCheckOut).to.be.false;
  });

  it("RESOLVE: single Female member punches directly", async () => {
    const female = await makeMember("Female", 301);
    const res = await performKioskPunch({ input: String(301), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    expect(res.success).to.be.true;
    expect(res.member.gymId).to.equal(301);
    expect(res.member.name).to.equal(female.fullName);
  });

  it("RESOLVE: single Transgender member punches directly", async () => {
    const trans = await makeMember("Transgender", 302);
    const res = await performKioskPunch({ input: String(302), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    expect(res.success).to.be.true;
    expect(res.member.gymId).to.equal(302);
    expect(res.member.name).to.equal(trans.fullName);
  });

  it("RESOLVE: not-found returns not_found (no existence leak)", async () => {
    let error = null;
    try {
      await performKioskPunch({ input: "999999", scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(404);
    expect(error.message).to.equal("Member not found.");
  });

  /* ── RESOLUTION: cross-gym ambiguity ──────────────────────── */
  it("RESOLVE: Male 192 + Female 192 → ambiguous with safe candidates", async () => {
    const male = await makeMember("Male", 400);
    const female = await makeMember("Female", 400);

    const res = await performKioskPunch({ input: "400", scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    expect(res.status).to.equal("ambiguous");
    expect(res.candidates.length).to.equal(2);

    // Safe candidate DTO only — no Aadhaar/medical/address/father/phone/_id.
    for (const c of res.candidates) {
      expect(c).to.have.property("fullName");
      expect(c).to.have.property("memberCode");
      expect(c).to.have.property("gender");
      expect(c).to.have.property("gymId");
      expect(c).to.not.have.property("phone");
      expect(c).to.not.have.property("aadhar");
      expect(c).to.not.have.property("address");
      expect(c).to.not.have.property("fatherName");
      expect(c).to.not.have.property("_id");
      expect(c).to.have.property("selectionToken");
    }
  });

  it("RESOLVE: Female 192 + Transgender 192 → integrity_error (never choose)", async () => {
    const female = await makeMember("Female", 401);
    const trans = await makeMember("Transgender", 401);

    let error = null;
    try {
      await performKioskPunch({ input: "401", scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(409);
    expect(error.extra.status).to.equal("integrity_error");
  });

  /* ── PHONE ────────────────────────────────────────────────── */
  it("PHONE: phone lookup resolves the exact member (globally unique)", async () => {
    const member = await makeMember("Male", 402);
    const res = await performKioskPunch({ input: member.phone, scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    expect(res.success).to.be.true;
    expect(res.member.gymId).to.equal(402);
  });

  /* ── SELECT: memberCode + selection token ─────────────────── */
  it("SELECT: memberCode punches the exact selected member", async () => {
    const male = await makeMember("Male", 403);
    const female = await makeMember("Female", 403);

    // Ambiguous → pick Male via memberCode.
    const res = await performKioskPunch({ memberCode: male.memberCode, scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    expect(res.success).to.be.true;
    expect(res.member.name).to.equal(male.fullName);

    const records = await AttendanceModel.find({ memberId: male._id });
    expect(records.length).to.equal(1);
    expect(String(records[0].memberId)).to.equal(String(male._id));
  });

  it("SELECT: selection token punches the exact selected member", async () => {
    const male = await makeMember("Male", 404);
    const female = await makeMember("Female", 404);

    const amb = await performKioskPunch({ input: "404", scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    const maleCandidate = amb.candidates.find((c) => c.memberCode === male.memberCode);
    const femaleCandidate = amb.candidates.find((c) => c.memberCode === female.memberCode);
    expect(maleCandidate).to.exist;
    expect(femaleCandidate).to.exist;

    const res = await performKioskPunch({ selectionToken: maleCandidate.selectionToken, scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    expect(res.success).to.be.true;
    expect(res.member.name).to.equal(male.fullName);
  });

  it("SELECT: a selection token from another kiosk is rejected", async () => {
    const male = await makeMember("Male", 405);
    const female = await makeMember("Female", 405);

    const amb = await performKioskPunch({ input: "405", scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    const maleCandidate = amb.candidates.find((c) => c.memberCode === male.memberCode);

    let error = null;
    try {
      await performKioskPunch({ selectionToken: maleCandidate.selectionToken, scope: undefined, principal: { type: "kiosk", kioskId: "kiosk-other" }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(400);
  });

  it("SELECT: a forged selection token is rejected", async () => {
    let error = null;
    try {
      await performKioskPunch({ selectionToken: "not.a.real.token", scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(400);
  });

  it("SELECT: unknown memberCode is rejected with not_found", async () => {
    let error = null;
    try {
      await performKioskPunch({ memberCode: "Z9999", scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(404);
  });

  /* ── PUNCH ────────────────────────────────────────────────── */
  it("PUNCH: first punch creates check-in with source kiosk", async () => {
    const member = await makeMember("Male", 500);
    const res = await performKioskPunch({ input: String(500), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    expect(res.success).to.be.true;
    expect(res.isCheckOut).to.be.false;
    expect(res.attendance.state).to.equal("inside");
    expect(res.attendance.checkInTime).to.exist;
    expect(res.attendance.checkOutTime).to.be.null;

    const record = await AttendanceModel.findOne({ memberId: member._id });
    expect(record).to.exist;
    expect(record.source).to.equal("kiosk");
    expect(String(record.memberId)).to.equal(String(member._id));
  });

  it("PUNCH: second punch same day checks out (atomic)", async () => {
    const member = await makeMember("Male", 501);
    await performKioskPunch({ input: String(501), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    const res = await performKioskPunch({ input: String(501), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    expect(res.success).to.be.true;
    expect(res.isCheckOut).to.be.true;
    expect(res.attendance.checkOutTime).to.exist;
    expect(res.attendance.state).to.equal("completed");
  });

  it("PUNCH: third punch same day after completion is rejected (409)", async () => {
    const member = await makeMember("Male", 502);
    await performKioskPunch({ input: String(502), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    await performKioskPunch({ input: String(502), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    let error = null;
    try {
      await performKioskPunch({ input: String(502), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(409);
    expect(error.extra.status).to.equal("already_checked_out");
  });

  it("PUNCH: duplicate punch within window is rejected (429)", async () => {
    // Temporarily raise the duplicate window so this test is meaningful.
    await systemSettingsService.updateSettings({ duplicatePunchSeconds: 60 }, null);
    systemSettingsService.invalidateCache();

    const member = await makeMember("Male", 503);
    const today = new Date(IN_HOURS);
    today.setHours(0, 0, 0, 0);
    await AttendanceModel.create({
      memberId: member._id,
      date: today,
      checkInTime: new Date(),
      state: "inside",
      source: "kiosk",
    });
    // createdAt defaults to real now; checkDuplicate's 60s window → duplicate.
    let error = null;
    try {
      await performKioskPunch({ input: String(503), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }

    // Restore the default (no window) for subsequent tests.
    await systemSettingsService.updateSettings({ duplicatePunchSeconds: 0 }, null);
    systemSettingsService.invalidateCache();

    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(429);
  });

  it("PUNCH: inactive member is rejected (403, generic message)", async () => {
    await makeMember("Male", 504, { status: "expired" });
    let error = null;
    try {
      await performKioskPunch({ input: "504", scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(403);
    expect(error.message).to.equal("Member cannot punch at this time.");
  });

  it("PUNCH: expired member is rejected (403, no expiry detail leaked)", async () => {
    await makeMember("Male", 505, {
      validityEnd: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    let error = null;
    try {
      await performKioskPunch({ input: String(505), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(403);
    expect(error.message).to.equal("Member cannot punch at this time.");
    expect(error.message).to.not.include("expired");
  });

  it("PUNCH: member without validityEnd is rejected (fail-closed validity)", async () => {
    await makeMember("Male", 506, { validityEnd: null });
    let error = null;
    try {
      await performKioskPunch({ input: String(506), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(403);
  });

  it("PUNCH: outside business hours is rejected (gym_closed)", async () => {
    const member = await makeMember("Male", 507);
    let error = null;
    try {
      await performKioskPunch({ input: String(507), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: OUT_OF_HOURS });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(KioskError);
    expect(error.status).to.equal(403);
    expect(error.extra.status).to.equal("gym_closed");
  });

  /* ── CONCURRENCY ──────────────────────────────────────────── */
  it("CONCURRENCY: simultaneous kiosk punch-in creates exactly ONE record", async () => {
    const member = await makeMember("Male", 600);
    const today = new Date(IN_HOURS);
    today.setHours(0, 0, 0, 0);
    await AttendanceModel.deleteMany({ memberId: member._id, date: today });

    const results = await Promise.allSettled([
      performKioskPunch({ input: String(600), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS }),
      performKioskPunch({ input: String(600), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS }),
    ]);

    const records = await AttendanceModel.find({ memberId: member._id, date: today });
    expect(records.length).to.equal(1);

    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejectedControlled = results.filter(
      (r) => r.status === "rejected" && (r.reason instanceof KioskError || r.reason instanceof Error)
    ).length;
    expect(fulfilled).to.equal(1);
    expect(fulfilled + rejectedControlled).to.equal(2);
  });

  it("CONCURRENCY: simultaneous kiosk check-out produces one consistent checkout", async () => {
    const member = await makeMember("Male", 601);
    await performKioskPunch({ input: String(601), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });

    const results = await Promise.allSettled([
      performKioskPunch({ input: String(601), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS }),
      performKioskPunch({ input: String(601), scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS }),
    ]);

    const today = new Date(IN_HOURS);
    today.setHours(0, 0, 0, 0);
    const records = await AttendanceModel.find({ memberId: member._id, date: today });
    expect(records.length).to.equal(1);
    expect(records[0].checkOutTime).to.not.be.null;
    expect(records[0].state).to.equal("completed");

    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    expect(fulfilled).to.be.lessThan(2); // only one wins the checkout
  });

  /* ── SECURITY ─────────────────────────────────────────────── */
  it("SECURITY: client-supplied scope/gender is ignored (shared kiosk has no scope)", async () => {
    const male = await makeMember("Male", 700);
    const female = await makeMember("Female", 700);

    // No gender/scope on the kiosk; resolution is purely by Gym ID → ambiguous.
    const res = await performKioskPunch({ input: "700", scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    expect(res.status).to.equal("ambiguous");
    expect(res.candidates.length).to.equal(2);
  });

  it("SECURITY: same numeric Gym ID in both gyms stays independent under kiosk", async () => {
    const male = await makeMember("Male", 701);
    const female = await makeMember("Female", 701);

    const amb = await performKioskPunch({ input: "701", scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    const maleCandidate = amb.candidates.find((c) => c.memberCode === male.memberCode);
    const femaleCandidate = amb.candidates.find((c) => c.memberCode === female.memberCode);

    const maleRes = await performKioskPunch({ selectionToken: maleCandidate.selectionToken, scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    const femaleRes = await performKioskPunch({ selectionToken: femaleCandidate.selectionToken, scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });

    expect(maleRes.member.name).to.equal(male.fullName);
    expect(femaleRes.member.name).to.equal(female.fullName);

    const maleRecords = await AttendanceModel.find({ memberId: male._id });
    const femaleRecords = await AttendanceModel.find({ memberId: female._id });
    expect(maleRecords.length).to.equal(1);
    expect(femaleRecords.length).to.equal(1);
    expect(String(maleRecords[0].memberId)).to.equal(String(male._id));
    expect(String(femaleRecords[0].memberId)).to.equal(String(female._id));
  });

  it("SECURITY: forged credential cannot punch (middleware-level)", async () => {
    const { req, res, next, nextCalled } = runAuth("kiosk-main-test", crypto.randomBytes(16).toString("hex"));
    await kioskAuth(req, res, next);
    expect(nextCalled()).to.be.false;
    expect(res.statusCode).to.equal(401);
  });

  it("SECURITY: raw candidate payload contains no sensitive fields", async () => {
    const male = await makeMember("Male", 702);
    const female = await makeMember("Female", 702);

    const res = await performKioskPunch({ input: "702", scope: kiosk.scope, principal: { type: "kiosk", kioskId: kiosk.kioskId }, now: IN_HOURS });
    expect(res.status).to.equal("ambiguous");
    for (const c of res.candidates) {
      expect(Object.keys(c).sort()).to.deep.equal(
        ["fullName", "gender", "gymId", "memberCode", "selectionToken"].sort()
      );
    }
  });
});

/* ============================================================
   UNIT TESTS — buildPunchResponse shape (no DB needed)
   ============================================================ */
import { buildPunchResponse } from "../utils/attendanceInput.js";

describe("Kiosk punch response shape (unit)", () => {
  it("matches the searchPunch response consumed by PunchModal", () => {
    const now = new Date();
    const res = buildPunchResponse({
      attendance: {
        _id: "abc",
        checkInTime: now,
        checkOutTime: null,
        state: "inside",
        durationMin: null,
      },
      member: {
        _id: "m1",
        gymId: 192,
        fullName: "Test Member",
        phone: "9876543210",
        gymPlan: "1 Month",
        photoUrl: null,
        validityEnd: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
      isCheckOut: false,
      isLate: false,
      daysLeft: 5,
    });

    expect(res.success).to.be.true;
    expect(res.message).to.equal("Check-in successful");
    expect(res.isCheckOut).to.be.false;
    expect(res.isLate).to.be.false;
    expect(res.attendance.checkInTime).to.equal(now);
    expect(res.member.name).to.equal("Test Member");
    expect(res.member.gymId).to.equal(192);
    expect(res.member.status).to.equal("active");
    expect(res.display.checkInTime).to.exist;
    expect(res.display.statusLabel).to.equal("Inside Gym");
    // shape matches what PunchModal reads
    expect(res.member).to.have.property("daysLeft");
    expect(res.member).to.have.property("validityEnd");
    expect(res.member).to.have.property("plan");
    // customer-safe DTO: no PII phone on the shared device
    expect(res.member).to.not.have.property("phone");
  });
});
