import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
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
import { generateActivation, redeemActivation } from "../services/deviceActivationService.js";
import { seedTestBranch } from "./utils/branchFixture.js";

describe("Direct device activation flow", function () {
  this.timeout(60000);
  // redeemActivation wraps its writes in a mongoose transaction, so this suite
  // needs a real replica set. Note: MongoMemoryServer.create() ignores a
  // top-level `replSet` option (it boots a standalone) — MongoMemoryReplSet is
  // the API that actually creates one.
  let mongoServer;
  let branch;

  before(async function () {
    mongoServer = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    const uri = mongoServer.getUri();
    await mongoose.connect(uri, { dbName: "gym_test" });
    branch = await seedTestBranch();
    await Kiosk.deleteMany({});
    await Admin.deleteMany({});
    await DeviceRegistration.deleteMany({});
    await mongoose.connection.collection("deviceactivations")?.deleteMany({});
  });

  after(async function () {
    if (mongoose.connection.readyState === 1) {
      await Kiosk.deleteMany({});
      await Admin.deleteMany({});
      await DeviceRegistration.deleteMany({});
      await mongoose.connection.collection("deviceactivations")?.deleteMany({});
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it("generates a code, activates the device, and deactivates prior registrations", async () => {
    const superAdmin = await Admin.create({
      fullName: "Super Admin",
      branchId: branch._id,
      username: `sa_${crypto.randomUUID().slice(0, 8)}`,
      email: `${crypto.randomUUID()}@example.com`,
      role: "superadmin",
      scope: "all",
      passwordHash: await bcrypt.hash("superpass", 10),
      status: "active",
      tokenVersion: 0,
    });

    const trainer = await Admin.create({
      fullName: "Trainer One",
      branchId: branch._id,
      username: `trainer_${crypto.randomUUID().slice(0, 8)}`,
      email: `${crypto.randomUUID()}@example.com`,
      role: "trainer",
      scope: "male",
      passwordHash: await bcrypt.hash("pass123", 10),
      status: "active",
      tokenVersion: 0,
    });

    const kiosk = await Kiosk.create({
      kioskId: `male-${crypto.randomUUID().slice(0, 8)}`,
      name: "Male Kiosk",
      scope: "male",
      enabled: true,
      branchId: branch._id,
    });

    const first = await DeviceRegistration.create({
      registrationId: crypto.randomUUID(),
      kioskId: kiosk.kioskId,
      trainerId: trainer._id,
      browserDeviceId: "old-browser",
      active: true,
      apiKeyHash: await bcrypt.hash("old-key", 10),
      keyFingerprint: crypto.createHash("sha256").update("old-key").digest("hex"),
      activatedAt: new Date(),
    });

    const activation = await generateActivation({
      trainerId: trainer._id,
      createdBy: superAdmin._id,
    });

    expect(activation.code).to.match(/^\d{6}$/);
    // generateActivation binds the Trainer + scope only; the device is bound
    // at redemption (kioskId = browserDeviceId), so no kioskId here.
    expect(activation.trainerId).to.equal(String(trainer._id));
    expect(activation.scope).to.equal("male");

    const result = await redeemActivation({
      trainerId: trainer._id,
      browserDeviceId: "new-browser",
      code: activation.code,
      password: "pass123",
    });

    expect(result.registration.active).to.equal(true);
    // Redemption binds the device identity, not the Kiosk document's id.
    expect(result.registration.kioskId).to.equal("new-browser");

    const activeCount = await DeviceRegistration.countDocuments({ trainerId: trainer._id, active: true });
    expect(activeCount).to.equal(1);

    const oldStillExists = await DeviceRegistration.findById(first._id).lean();
    expect(oldStillExists.active).to.equal(false);
  });
});
