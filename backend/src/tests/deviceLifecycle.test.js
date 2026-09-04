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
import { deactivateRegistration, revokeRegistration, rotateRegistration, reassignKioskScope, reactivateRegistration, lockRegistration, unlockRegistration } from "../services/deviceRegistrationService.js";
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
/* ============================================================
   DEACTIVATION → REACTIVATION LIFECYCLE (requires MongoDB)
   ============================================================ */
describe("Device Lifecycle — trainer deactivation → reactivation (integration)", function () {
  this.timeout(30000);
  let connected = false;
  let trainerA, trainerB, superAdmin;

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      await Admin.deleteMany({});
      await Kiosk.deleteMany({});
      await DeviceRegistration.deleteMany({});
      await DeviceActivation.deleteMany({});

      trainerA = (await Admin.create({
        fullName: "Reactive A", username: `ra_a_${crypto.randomUUID().slice(0, 8)}`,
        email: `ra_a_${crypto.randomUUID().slice(0, 8)}@test.local`, role: "trainer", scope: "male",
        passwordHash: await bcrypt.hash("pass", 4), status: "active", tokenVersion: 0,
      }))._id;
      trainerB = (await Admin.create({
        fullName: "Reactive B", username: `ra_b_${crypto.randomUUID().slice(0, 8)}`,
        email: `ra_b_${crypto.randomUUID().slice(0, 8)}@test.local`, role: "trainer", scope: "male",
        passwordHash: await bcrypt.hash("pass", 4), status: "active", tokenVersion: 0,
      }))._id;
      superAdmin = (await Admin.create({
        fullName: "Reactive Super", username: `ra_sa_${crypto.randomUUID().slice(0, 8)}`,
        email: `ra_sa_${crypto.randomUUID().slice(0, 8)}@test.local`, role: "superadmin", scope: "all",
        passwordHash: await bcrypt.hash("pass", 4), status: "active", tokenVersion: 0,
      }))._id;
      await Kiosk.create({ kioskId: "lifecycle-test", name: "Lifecycle Kiosk", scope: "male", enabled: true });
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

  // Helper: create an active registration owned by a trainer.
  async function createActiveRegistration(ownerId, browserDeviceId, kioskId = "lifecycle-test") {
    const apiKey = crypto.randomBytes(32).toString("base64url");
    const reg = await DeviceRegistration.create({
      registrationId: crypto.randomUUID(),
      kioskId,
      trainerId: ownerId,
      browserDeviceId,
      apiKeyHash: await bcrypt.hash(apiKey, 10),
      keyFingerprint: fp(apiKey),
      active: true,
      activatedAt: new Date(),
    });
    return { reg, apiKey };
  }
// ── 1. Trainer deactivates → reactivates SAME registration → SUCCESS ──
  it("reactivation: trainer deactivates then reactivates the SAME registration (fresh credential)", async () => {
    const { reg, apiKey } = await createActiveRegistration(trainerA, "b-reactivate-1");
    const deactivated = await deactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    expect(deactivated.active).to.be.false;
    expect(deactivated.deactivationReason).to.equal("trainer");
    expect(deactivated.deactivatedAt).to.exist;
    // Old credential must NOT authenticate while inactive.
    const { res: oldAuth } = await callKioskAuth("lifecycle-test", apiKey);
    expect(oldAuth.statusCode).to.equal(401);

    const reactivated = await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    expect(reactivated.registration.active).to.be.true;
    expect(reactivated.registration.deactivationReason).to.be.null;
    expect(reactivated.registration.reactivatedAt).to.exist;
    expect(reactivated.apiKey).to.be.a("string");
    expect(reactivated.apiKey).to.not.equal(apiKey);

    const { nextCalled } = await callKioskAuth("lifecycle-test", reactivated.apiKey);
    expect(nextCalled).to.be.true;
    const { res: oldAgain } = await callKioskAuth("lifecycle-test", apiKey);
    expect(oldAgain.statusCode).to.equal(401);
  });

  // ── 2. Reactivated device can perform attendance via kioskAuth ──
  it("reactivation: reactivated device performs attendance via kioskAuth", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-2");
    await deactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    const { apiKey } = await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    const { nextCalled } = await callKioskAuth("lifecycle-test", apiKey);
    expect(nextCalled).to.be.true;
  });

  // ── 3. Another trainer cannot reactivate it ──
  it("reactivation-denied-owner: trainer B cannot reactivate trainer A's deactivated registration", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-3");
    await deactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    let threw = false;
    try {
      await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerB });
    } catch (err) {
      threw = true;
      expect(err.status).to.equal(403);
    }
    expect(threw).to.be.true;
    const fresh = await DeviceRegistration.findOne({ registrationId: reg.registrationId }).lean();
    expect(fresh.active).to.be.false;
  });

  // ── 4. Super Admin revokes → Trainer reactivate → 403 ──
  it("reactivation-denied-revoked: super admin revokes → trainer reactivate returns 403", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-4");
    await revokeRegistration({ registrationId: reg.registrationId, isSuperAdmin: true });
    let threw = false;
    try {
      await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    } catch (err) {
      threw = true;
      expect(err.status).to.equal(403);
    }
    expect(threw).to.be.true;
    const fresh = await DeviceRegistration.findOne({ registrationId: reg.registrationId }).lean();
    expect(fresh.active).to.be.false;
    expect(fresh.revokedAt).to.exist;
  });
// ── 5. Replacement (new activation) → old device reactivate → 403 ──
  it("reactivation-denied-replaced: replacement makes old registration non-reactivatable", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-5");
    const activation = await generateActivation({ trainerId: trainerA, createdBy: superAdmin });
    await redeemActivation({
      trainerId: trainerA, browserDeviceId: "b-reactivate-5-new",
      code: activation.code, password: "pass",
    });
    const old = await DeviceRegistration.findOne({ registrationId: reg.registrationId }).lean();
    expect(old.active).to.be.false;
    expect(old.deactivationReason).to.equal("replaced");
    let threw = false;
    try {
      await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    } catch (err) {
      threw = true;
      expect(err.status).to.equal(403);
    }
    expect(threw).to.be.true;
  });

  // ── 6. Scope reassignment → old device reactivate → 403 ──
  it("reactivation-denied-scope: scope reassignment makes old registration non-reactivatable", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-6");
    await reassignKioskScope({ kioskId: "lifecycle-test", newScope: "female_plus_transgender", isSuperAdmin: true });
    const old = await DeviceRegistration.findOne({ registrationId: reg.registrationId }).lean();
    expect(old.revokedAt).to.exist;
    expect(old.deactivationReason).to.equal("scope_reassigned");
    let threw = false;
    try {
      await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    } catch (err) {
      threw = true;
      expect(err.status).to.equal(403);
    }
    expect(threw).to.be.true;
    await reassignKioskScope({ kioskId: "lifecycle-test", newScope: "male", isSuperAdmin: true });
  });

  // ── 7. Another trainer owns same browser → ownership conflict (409) ──
  it("reactivation-conflict-owner: other trainer owns the same browser → 409", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-7");
    await deactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    const bs = crypto.randomBytes(32).toString("base64url");
    await DeviceRegistration.create({
      registrationId: crypto.randomUUID(), kioskId: "lifecycle-test",
      trainerId: trainerB, browserDeviceId: "b-reactivate-7",
      apiKeyHash: await bcrypt.hash(bs, 10), keyFingerprint: fp(bs),
      active: true, activatedAt: new Date(),
    });
    let threw = false;
    try {
      await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    } catch (err) {
      threw = true;
      expect(err.status).to.equal(409);
    }
    expect(threw).to.be.true;
  });

  // ── 8. Lock → Unlock → attendance works ──
  it("lock-unlock: lock → unlock → attendance resumes", async () => {
    const { reg, apiKey } = await createActiveRegistration(trainerA, "b-reactivate-8");
    const { nextCalled: okBefore } = await callKioskAuth("lifecycle-test", apiKey);
    expect(okBefore).to.be.true;
    await lockRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    const { res: lockedRes } = await callKioskAuth("lifecycle-test", apiKey);
    expect(lockedRes.statusCode).to.equal(403);
    await unlockRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    const { nextCalled: okAfter } = await callKioskAuth("lifecycle-test", apiKey);
    expect(okAfter).to.be.true;
  });
// ── 9. Locked device remains active (not historical) ──
  it("locked-keeps-active: locked registration stays active=true and NOT historical", async () => {
    const { reg, apiKey } = await createActiveRegistration(trainerA, "b-reactivate-9");
    await lockRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    const fresh = await DeviceRegistration.findOne({ registrationId: reg.registrationId }).lean();
    expect(fresh.active).to.be.true;
    expect(fresh.locked).to.be.true;
    expect(fresh.deactivatedAt).to.be.null;
    expect(fresh.revokedAt).to.be.null;
    expect(fresh.deactivationReason).to.be.null;
    const { res: lockedRes } = await callKioskAuth("lifecycle-test", apiKey);
    expect(lockedRes.statusCode).to.equal(403);
  });

  // ── 10. Reactivation preserves/validates correct scope ──
  it("reactivation-scope: reactivation preserves trainer scope and kiosk scope", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-10");
    const originalScope = (await Admin.findById(trainerA).lean()).scope;
    await deactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    const result = await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    expect(result.registration.active).to.be.true;
    const kioskNow = await Kiosk.findOne({ kioskId: "lifecycle-test" }).lean();
    expect(kioskNow.scope).to.equal(originalScope);
  });

  // ── 11. Reactivation cannot create duplicate active registration ──
  it("reactivation-unique: cannot have two active registrations (INVARIANT A)", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-11");
    await deactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    const activeCount = await DeviceRegistration.countDocuments({ trainerId: trainerA, active: true });
    expect(activeCount).to.equal(1);
  });

  // ── 12. Concurrent reactivation attempts remain atomic ──
  it("reactivation-concurrent: two concurrent reactivations yield exactly one success", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-12");
    await deactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    const [r1, r2] = await Promise.allSettled([
      reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA }),
      reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA }),
    ]);
    const successes = [r1, r2].filter((r) => r.status === "fulfilled");
    const failures = [r1, r2].filter((r) => r.status === "rejected");
    expect(successes.length).to.equal(1);
    expect(failures.length).to.equal(1);
    const activeCount = await DeviceRegistration.countDocuments({ trainerId: trainerA, active: true });
    expect(activeCount).to.equal(1);
  });
// ── 13. Kiosk disabled → reactivation rejected ──
  it("reactivation-denied-disabled: disabled kiosk rejects reactivation", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-13");
    await deactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    await Kiosk.updateOne({ kioskId: "lifecycle-test" }, { $set: { enabled: false } });
    let threw = false;
    try {
      await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    } catch (err) {
      threw = true;
      expect(err.status).to.equal(409);
    }
    await Kiosk.updateOne({ kioskId: "lifecycle-test" }, { $set: { enabled: true } });
    expect(threw).to.be.true;
  });

  // ── 14. Inactive trainer → reactivation rejected ──
  it("reactivation-denied-trainer-status: disabled trainer cannot reactivate", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-14");
    await deactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    await Admin.updateOne({ _id: trainerA }, { $set: { status: "disabled" } });
    let threw = false;
    try {
      await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
    } catch (err) {
      threw = true;
      expect(err.status).to.equal(403);
    }
    await Admin.updateOne({ _id: trainerA }, { $set: { status: "active" } });
    expect(threw).to.be.true;
  });

  // ── 15. Repeated deactivate → reactivate cycles work safely ──
  it("reactivation-cycles: repeated deactivate→reactivate cycles each issue a fresh credential", async () => {
    const { reg, apiKey: firstKey } = await createActiveRegistration(trainerA, "b-reactivate-15");
    let previousKey = firstKey;
    for (let cycle = 0; cycle < 3; cycle++) {
      await deactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
      const { apiKey } = await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
      expect(apiKey).to.not.equal(previousKey);
      const { nextCalled } = await callKioskAuth("lifecycle-test", apiKey);
      expect(nextCalled).to.be.true;
      const { res: oldRes } = await callKioskAuth("lifecycle-test", previousKey);
      expect(oldRes.statusCode).to.equal(401);
      previousKey = apiKey;
    }
    const activeCount = await DeviceRegistration.countDocuments({ trainerId: trainerA, active: true });
    expect(activeCount).to.equal(1);
  });

  // ── 16. Revoked registration remains permanently non-reactivatable ──
  it("reactivation-permanent: revoked registration rejects reactivation forever", async () => {
    const { reg } = await createActiveRegistration(trainerA, "b-reactivate-16");
    await revokeRegistration({ registrationId: reg.registrationId, isSuperAdmin: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      let threw = false;
      try {
        await reactivateRegistration({ registrationId: reg.registrationId, trainerId: trainerA });
      } catch (err) {
        threw = true;
        expect(err.status).to.equal(403);
      }
      expect(threw).to.be.true;
    }
    const fresh = await DeviceRegistration.findOne({ registrationId: reg.registrationId }).lean();
    expect(fresh.active).to.be.false;
    expect(fresh.revokedAt).to.exist;
  });
});