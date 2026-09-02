/**
 * DeviceRegistration — Phase 1 model + Database Invariant Gate tests
 *
 * UNIT (no DB):
 *   - schema field definitions
 *   - index definitions present (partial unique active indexes)
 *
 * INTEGRATION (requires MongoDB; skips when unreachable):
 *   Gate A — partial unique { trainerId } where active:true is created and
 *            ENFORCED: a Trainer cannot have two active devices.
 *   Gate B — partial unique { kioskId } where active:true is created and
 *            ENFORCED: two Trainers cannot both be active on one browser/Kiosk.
 *   Gate C — unique { kioskId, keyFingerprint } enforced (O(1) credential lookup).
 *   Historical — inactive registrations for the same kiosk/trainer may coexist.
 *
 * These tests are destructive on the target DB (deleteMany) and MUST run only
 * against a dedicated test database — never production.
 *
 * Run: cd backend && npx mocha src/tests/deviceRegistration.test.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { expect } from "chai";

dotenv.config();

import "../models/Kiosk.js";
import "../models/Admin.js";
import "../models/DeviceRegistration.js";

const DeviceRegistration = mongoose.model("DeviceRegistration");

// Same convention as export.test.js — dedicated test DB, never production.
const DB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/gym_test";

const SAMPLE = {
  registrationId: "reg-1",
  kioskId: "browser-abc-123",
  trainerId: new mongoose.Types.ObjectId(),
  browserDeviceId: "browser-abc-123",
  apiKeyHash: "$2a$10$simulatedhashsimulatedhashsimulatedhas",
  keyFingerprint: "a1b2c3d4e5f60718",
};

// Assert a promise rejects with a Mongo duplicate-key error (E11000).
async function assertDuplicateKey(promise, label) {
  let rejected = false;
  try {
    await promise;
  } catch (err) {
    rejected = true;
    const msg = String(err?.message || "");
    expect(msg, `${label}: expected duplicate-key error, got: ${msg}`).to.match(/E11000|duplicate key/);
  }
  expect(rejected, `${label}: expected promise to reject`).to.be.true;
}

/* ============================================================
   UNIT — schema + index definitions (no DB)
   ============================================================ */
describe("DeviceRegistration schema (unit)", () => {
  it("defines the required fields", () => {
    const paths = DeviceRegistration.schema.paths;
    for (const field of ["registrationId", "kioskId", "trainerId", "browserDeviceId", "apiKeyHash", "keyFingerprint", "active"]) {
      expect(paths[field], `missing field ${field}`).to.exist;
    }
    expect(paths.active.instance).to.equal("Boolean");
  });

  it("defines INVARIANT A: unique partial { trainerId } where active:true", () => {
    const indexes = DeviceRegistration.schema.indexes();
    const idx = indexes.find(([spec, opts]) => spec.trainerId === 1 && Object.keys(spec).length === 1);
    expect(idx, "INVARIANT A index not defined").to.exist;
    expect(idx[1].unique).to.be.true;
    expect(idx[1].partialFilterExpression).to.deep.equal({ active: true });
  });

  it("defines INVARIANT B: unique partial { kioskId } where active:true", () => {
    const indexes = DeviceRegistration.schema.indexes();
    const idx = indexes.find(([spec, opts]) => spec.kioskId === 1 && Object.keys(spec).length === 1);
    expect(idx, "INVARIANT B index not defined").to.exist;
    expect(idx[1].unique).to.be.true;
    expect(idx[1].partialFilterExpression).to.deep.equal({ active: true });
  });

  it("defines INVARIANT C: unique { kioskId, keyFingerprint }", () => {
    const indexes = DeviceRegistration.schema.indexes();
    const idx = indexes.find(([spec]) => spec.kioskId === 1 && spec.keyFingerprint === 1);
    expect(idx?.[1].unique).to.be.true;
  });
});

/* ============================================================
   INTEGRATION — Database Invariant Gate (requires MongoDB)
   ============================================================ */
describe("DeviceRegistration Database Invariant Gate (integration)", function () {
  this.timeout(30000);
  let connected = false;

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      await DeviceRegistration.init();
      await DeviceRegistration.deleteMany({});
    } catch (err) {
      this.skip();
    }
  });

  after(async () => {
    if (connected) {
      await DeviceRegistration.deleteMany({});
      await mongoose.disconnect();
    }
  });

  const makeDoc = (overrides = {}) => {
    const regId = overrides.registrationId || SAMPLE.registrationId;
    return {
      ...SAMPLE,
      ...(overrides.keyFingerprint === undefined ? { keyFingerprint: regId + "-fp" } : {}),
      ...overrides,
    };
  };

  it("Gate A: partial unique { trainerId } where active:true is created and enforced", async () => {
    const indexes = await DeviceRegistration.collection.indexes();
    const found = indexes.find((i) => i.name === "idx_devicereg_trainer_active_unique");
    expect(found, "INVARIANT A index not present in MongoDB").to.exist;
    expect(found.unique).to.be.true;
    expect(found.partialFilterExpression).to.deep.equal({ active: true });

    const first = await DeviceRegistration.create(makeDoc({}));
    expect(first.active).to.be.true;

    // Second active registration for the SAME Trainer is rejected.
    await assertDuplicateKey(
      DeviceRegistration.create(makeDoc({ registrationId: "reg-a-dup", active: true, browserDeviceId: "browser-y-2", keyFingerprint: "reg-a-dup-fp" })),
      "duplicate active for same trainer"
    );
  });

  it("Gate B: partial unique { kioskId } where active:true is created and enforced", async () => {
    const indexes = await DeviceRegistration.collection.indexes();
    const found = indexes.find((i) => i.name === "idx_devicereg_kiosk_active_unique");
    expect(found, "INVARIANT B index not present in MongoDB").to.exist;
    expect(found.unique).to.be.true;
    expect(found.partialFilterExpression).to.deep.equal({ active: true });

    // A DIFFERENT Trainer tries to become active on the same browser/kiosk.
    const otherTrainer = new mongoose.Types.ObjectId();
    await assertDuplicateKey(
      DeviceRegistration.create(
        makeDoc({ registrationId: "reg-b-dup", trainerId: otherTrainer, active: true, keyFingerprint: "reg-b-dup-fp" })
      ),
      "second trainer on same browser"
    );
  });

  it("Gate B (historical): inactive registration on same kiosk may coexist", async () => {
    // Same kiosk as the active doc, but inactive → not constrained by INVARIANT B.
    const t1 = new mongoose.Types.ObjectId();
    await DeviceRegistration.create(
      makeDoc({ registrationId: "hist-1", trainerId: t1, active: false, deactivatedAt: new Date(), apiKeyHash: null, keyFingerprint: null })
    );
    const inactiveCount = await DeviceRegistration.countDocuments({
      kioskId: SAMPLE.kioskId,
      active: false,
    });
    expect(inactiveCount).to.be.at.least(1);
  });

  it("Gate C: unique keyFingerprint enforced", async () => {
    // Same kioskId + same keyFingerprint ("reg-1-fp") as the Gate A doc → collides
    // only on the unique (kioskId, keyFingerprint) index.
    await assertDuplicateKey(
      DeviceRegistration.create(
        makeDoc({ registrationId: "fp-dup", active: false, deactivatedAt: new Date(), browserDeviceId: "browser-other-999", keyFingerprint: "reg-1-fp", apiKeyHash: null })
      ),
      "duplicate keyFingerprint"
    );
  });

  it("lookup prefilter is queryable via indexed keyFingerprint", async () => {
    const found = await DeviceRegistration.findOne({
      kioskId: SAMPLE.kioskId,
      keyFingerprint: "reg-1-fp",
    }).lean();
    expect(found, "should find the Gate A doc by its fingerprint").to.exist;
    expect(found.browserDeviceId).to.equal(SAMPLE.browserDeviceId);
  });
});
