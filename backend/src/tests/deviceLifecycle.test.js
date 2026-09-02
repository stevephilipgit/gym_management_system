/**
 * Device Lifecycle — Registration lifecycle invariants (replacement for the
 * previous provisioning/claim-request lifecycle tests).
 *
 * Covers the supporting device-registration lifecycle:
 *   - kiosk-disable:   disabled Kiosk → punch fails (kioskAuth layer)
 *   - scope-reassign:  Kiosk scope changed → old registrations cannot punch
 *   - rotation:        credential rotate → new key works, old key rejected
 *   - concurrent-activation: two simultaneous activations → one succeeds
 *
 * Run: cd backend && npx mocha "src/tests/deviceLifecycle.test.js" --timeout 60000
 */

import mongoose from "mongoose";
import { expect } from "chai";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import "../models/Admin.js";
import "../models/Kiosk.js";
import "../models/DeviceRegistration.js";
import "../models/DeviceActivation.js";
import Admin from "../models/Admin.js";
import Kiosk from "../models/Kiosk.js";
import DeviceRegistration from "../models/DeviceRegistration.js";
import DeviceActivation from "../models/DeviceActivation.js";
import { deactivateRegistration, revokeRegistration, rotateRegistration, reassignKioskScope } from "../services/deviceRegistrationService.js";
import { generateActivation, redeemActivation } from "../services/deviceActivationService.js";
import kioskAuth from "../middleware/kioskAuth.js";

const DB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/gym_test";

function fp(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

async function callKioskAuth(kioskId, apiKey) {
  const req = { get: (h) => (h.toLowerCase() === "x-kiosk-id" ? kioskId : h.toLowerCase() === "x-kiosk-key" ? apiKey : null) };
  const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let nextCalled = false;
  await kioskAuth(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

/* ============================================================
   INTEGRATION TESTS — require MongoDB
   ============================================================ */
describe("Device Lifecycle — registration invariants (integration)", function () {
  this.timeout(30000);
  let connected = false;
  let trainerA, trainerB, superAdmin;
  let kiosk;

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      await Admin.deleteMany({});
      await Kiosk.deleteMany({});
      await DeviceRegistration.deleteMany({});
      await DeviceActivation.deleteMany({});

      trainerA = (await Admin.create({
        fullName: "Lifecycle A", username: `lc_a_${crypto.randomUUID().slice(0, 8)}`,
        email: `lc_a_${crypto.randomUUID().slice(0, 8)}@test.local`, role: "trainer", scope: "male",
        passwordHash: await bcrypt.hash("pass", 4), status: "active", tokenVersion: 0,
      }))._id;
      trainerB = (await Admin.create({
        fullName: "Lifecycle B", username: `lc_b_${crypto.randomUUID().slice(0, 8)}`,
        email: `lc_b_${crypto.randomUUID().slice(0, 8)}@test.local`, role: "trainer", scope: "male",
        passwordHash: await bcrypt.hash("pass", 4), status: "active", tokenVersion: 0,
      }))._id;
      superAdmin = (await Admin.create({
        fullName: "Lifecycle Super", username: `lc_sa_${crypto.randomUUID().slice(0, 8)}`,
        email: `lc_sa_${crypto.randomUUID().slice(0, 8)}@test.local`, role: "superadmin", scope: "all",
        passwordHash: await bcrypt.hash("pass", 4), status: "active", tokenVersion: 0,
      }))._id;
      kiosk = await Kiosk.create({ kioskId: "lifecycle-test", name: "Lifecycle Kiosk", scope: "male", enabled: true });
    } catch (err) {
      this.skip();
    }
  });

  after(async function () {
    if (connected) {
      await Admin.deleteMany({});
      await Kiosk.deleteMany({});
      await DeviceRegistration.deleteMany({});
      await DeviceActivation.deleteMany({});
      await mongoose.disconnect();
    }
  });

  beforeEach(async function () {
    if (!connected) return;
    await DeviceRegistration.deleteMany({});
    await DeviceActivation.deleteMany({});
  });

  /* ── kiosk-disable: disabled kiosk → punch fails ──────── */
  it("kiosk-disable: disabled Kiosk is rejected by kioskAuth even with valid key", async () => {
    const apiKey = crypto.randomBytes(32).toString("base64url");
    await DeviceRegistration.create({
      registrationId: "reg-disable-test", kioskId: "lifecycle-test",
      trainerId: trainerA, browserDeviceId: "b-disable",
      apiKeyHash: await bcrypt.hash(apiKey, 10), keyFingerprint: fp(apiKey),
      active: true, activatedAt: new Date(),
    });
    // Before disable: kioskAuth passes.
    const { nextCalled: ok } = await callKioskAuth("lifecycle-test", apiKey);
    expect(ok).to.be.true;
    // Disable the kiosk.
    await Kiosk.updateOne({ kioskId: "lifecycle-test" }, { $set: { enabled: false } });
    // After disable: kioskAuth rejects.
    const { res: authRes } = await callKioskAuth("lifecycle-test", apiKey);
    expect(authRes.statusCode).to.equal(403);
    // Re-enable for other tests.
    await Kiosk.updateOne({ kioskId: "lifecycle-test" }, { $set: { enabled: true } });
  });

  /* ── scope-reassign: scope change invalidates old registrations ── */
  it("scope-reassign: scope reassignment invalidates every active registration for the kiosk", async () => {
    const apiKey = crypto.randomBytes(32).toString("base64url");
    const reg = await DeviceRegistration.create({
      registrationId: "reg-scope-test", kioskId: "lifecycle-test",
      trainerId: trainerA, browserDeviceId: "b-scope",
      apiKeyHash: await bcrypt.hash(apiKey, 10), keyFingerprint: fp(apiKey),
      active: true, activatedAt: new Date(),
    });
    // Before reassign: kioskAuth passes.
    const { nextCalled: ok } = await callKioskAuth("lifecycle-test", apiKey);
    expect(ok).to.be.true;
    // Reassign scope.
    await reassignKioskScope({ kioskId: "lifecycle-test", newScope: "female_plus_transgender", isSuperAdmin: true });
    // After reassign: the registration was deactivated.
    const fresh = await DeviceRegistration.findById(reg._id).lean();
    expect(fresh.active).to.be.false;
    expect(fresh.revokedAt).to.exist;
    // kioskAuth rejects because the registration is no longer active.
    const { res: authRes } = await callKioskAuth("lifecycle-test", apiKey);
    expect(authRes.statusCode).to.equal(401);
    // Restore the kiosk scope for other tests.
    await reassignKioskScope({ kioskId: "lifecycle-test", newScope: "male", isSuperAdmin: true });
  });

  /* ── rotation: credential rotation works, old key rejected ── */
  it("rotation: credential rotation makes the old key invalid and the new key valid", async () => {
    const oldKey = crypto.randomBytes(32).toString("base64url");
    await DeviceRegistration.create({
      registrationId: "reg-rotate-test", kioskId: "lifecycle-test",
      trainerId: trainerA, browserDeviceId: "b-rotate",
      apiKeyHash: await bcrypt.hash(oldKey, 10), keyFingerprint: fp(oldKey),
      active: true, activatedAt: new Date(),
    });
    // Before rotation: old key works.
    const { nextCalled: ok } = await callKioskAuth("lifecycle-test", oldKey);
    expect(ok).to.be.true;
    // Rotate.
    const result = await rotateRegistration({ registrationId: "reg-rotate-test", isSuperAdmin: true });
    expect(result.apiKey).to.be.a("string");
    // After rotation: old key rejected.
    const { res: oldRes } = await callKioskAuth("lifecycle-test", oldKey);
    expect(oldRes.statusCode).to.equal(401);
    // New key works.
    const { nextCalled: ok2 } = await callKioskAuth("lifecycle-test", result.apiKey);
    expect(ok2).to.be.true;
  });

  /* ── concurrent-activation: only one activation succeeds ── */
  it("concurrent-activation: two simultaneous activations for same trainer yield one active device", async () => {
    const activation = await generateActivation({
      trainerId: trainerA, createdBy: superAdmin,
    });
    // Try to redeem the same activation twice concurrently.
    const [r1, r2] = await Promise.allSettled([
      redeemActivation({
        trainerId: trainerA, browserDeviceId: "b-concurrent-1",
        code: activation.code, password: "pass",
      }),
      redeemActivation({
        trainerId: trainerA, browserDeviceId: "b-concurrent-2",
        code: activation.code, password: "pass",
      }),
    ]);
    // Exactly one must succeed.
    const successes = [r1, r2].filter((r) => r.status === "fulfilled");
    const failures = [r1, r2].filter((r) => r.status === "rejected");
    expect(successes.length).to.equal(1);
    expect(failures.length).to.equal(1);
    // Verify only one active registration exists for this trainer.
    const activeCount = await DeviceRegistration.countDocuments({ trainerId: trainerA, active: true });
    expect(activeCount).to.equal(1);
    // The failed one should have a 409 message.
    const failMsg = failures[0].reason?.message || "";
    expect(failMsg).to.match(/already been used|already consumed|already has an active device/i);
  });
});