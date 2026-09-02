import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
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

describe("Direct device activation flow", function () {
  this.timeout(60000);
  let mongoServer;

  before(async function () {
    mongoServer = await MongoMemoryServer.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    const uri = mongoServer.getUri();
    await mongoose.connect(uri, { dbName: "gym_test" });
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
      kioskId: kiosk.kioskId,
      createdBy: superAdmin._id,
    });

    expect(activation.code).to.match(/^\d{6}$/);
    expect(activation.kioskId).to.equal(kiosk.kioskId);

    const result = await redeemActivation({
      trainerId: trainer._id,
      kioskId: kiosk.kioskId,
      browserDeviceId: "new-browser",
      code: activation.code,
      password: "pass123",
    });

    expect(result.registration.active).to.equal(true);
    expect(result.registration.kioskId).to.equal(kiosk.kioskId);

    const activeCount = await DeviceRegistration.countDocuments({ trainerId: trainer._id, active: true });
    expect(activeCount).to.equal(1);

    const oldStillExists = await DeviceRegistration.findById(first._id).lean();
    expect(oldStillExists.active).to.equal(false);
  });
});
