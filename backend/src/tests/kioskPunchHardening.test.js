/**
 * Kiosk punch hardening — controller-level security + performance invariants.
 *
 * Complements the service-level suites (kiosk.test.js, kioskScopedPunch.test.js)
 * which call performKioskPunch() directly. This file exercises the HTTP-facing
 * layer plus the invariants introduced by the kiosk-performance refactor:
 *
 *   1. Header shape gate (X-Kiosk-Id / X-Kiosk-Key) rejects BEFORE any DB work
 *   2. Joi payload gate: null/empty/oversized/multi-mode/unknown-key bodies → 400
 *   3. Selection token tampering, expiry and cross-kiosk reuse → 400
 *   4. ZERO third-party network I/O on the punch path (latency regression guard)
 *   5. The Google Sheets connector model/service no longer exists
 *   6. Out-of-scope member + duplicate punch still fail closed
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import http from "node:http";
import https from "node:https";
import { MongoMemoryServer } from "mongodb-memory-server";
import { expect } from "chai";

import Kiosk from "../models/Kiosk.js";
import DeviceRegistration from "../models/DeviceRegistration.js";
import Member from "../models/Member.js";
import SystemSettings from "../models/SystemSettings.js";
import Attendance from "../models/Attendance.js";
import kioskAuth from "../middleware/kioskAuth.js";
import { kioskPunch, validatePunchPayload } from "../controllers/kioskController.js";
import config from "../config/index.js";
import systemSettingsService from "../services/systemSettingsService.js";
import { seedTestBranch } from "./utils/branchFixture.js";

const KIOSK_ID = "kiosk-hardening-test";
const KIOSK_KEY = crypto.randomBytes(32).toString("base64url");
const VALID_HEADERS = { "x-kiosk-id": KIOSK_ID, "x-kiosk-key": KIOSK_KEY };

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

function mockReq({ headers = VALID_HEADERS, body = {}, ip = "10.0.0.5" } = {}) {
  return {
    ip,
    body,
    get: (name) => headers[String(name).toLowerCase()],
  };
}

// Sign a selection token exactly like kioskService does (same secret + payload).
function signSelectionToken(payload) {
  const secret = config.kiosk?.selectionSecret || config.jwt.accessSecret;
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

describe("Kiosk punch hardening — payload gate (Joi, no DB access)", () => {
  const badBodies = [
    ["null body", null],
    ["undefined body", undefined],
    ["array body", []],
    ["string body", "input=777"],
    ["empty object", {}],
    ["empty input string", { input: "" }],
    ["numeric input", { input: 777 }],
    ["whitespace-only input", { input: "   " }],
    ["oversized input (129 chars)", { input: "7".repeat(129) }],
    ["two identity modes", { input: "777", memberCode: "M0777" }],
    ["unknown key", { input: "777", scope: "female_plus_transgender" }],
  ];

  for (const [label, body] of badBodies) {
    it(`rejects ${label} with 400 invalid_payload`, async () => {
      const res = mockRes();
      await kioskPunch(mockReq({ body }), res);
      expect(res.statusCode).to.equal(400);
      expect(res.body.status).to.equal("invalid_payload");
      expect(res.body.message).to.be.a("string");
    });
  }

  it("does not reject a correctly shaped payload as invalid_payload", () => {
    const outcome = validatePunchPayload({ input: "777" });
    expect(outcome.valid).to.equal(true);
    expect(outcome.mode).to.equal("input");
    expect(outcome.value).to.equal("777");
  });
});

describe("Kiosk punch hardening — selection token gate (no DB access)", () => {
  const punchWithToken = async (token) => {
    const req = mockReq({ body: { selectionToken: token } });
    req.kiosk = { kioskId: KIOSK_ID, scope: "male" };
    const res = mockRes();
    await kioskPunch(req, res);
    return res;
  };

  const freshPayload = (kioskId = KIOSK_ID) => ({
    kind: "kiosk_selection",
    kioskId,
    memberId: String(new mongoose.Types.ObjectId()),
    iat: Date.now(),
    exp: Date.now() + 60000,
  });

  it("rejects a tampered signature with 400", async () => {
    const token = signSelectionToken(freshPayload());
    const res = await punchWithToken(`${token.slice(0, -1)}X`);
    expect(res.statusCode).to.equal(400);
  });

  it("rejects an expired token with 400", async () => {
    const token = signSelectionToken({
      ...freshPayload(),
      iat: Date.now() - 10 * 60 * 1000,
      exp: Date.now() - 60 * 1000,
    });
    const res = await punchWithToken(token);
    expect(res.statusCode).to.equal(400);
  });

  it("rejects a token issued for another kiosk with 400", async () => {
    const res = await punchWithToken(signSelectionToken(freshPayload("some-other-kiosk")));
    expect(res.statusCode).to.equal(400);
  });

  it("rejects a token signed with the wrong secret with 400", async () => {
    const body = Buffer.from(JSON.stringify(freshPayload())).toString("base64url");
    const sig = crypto.createHmac("sha256", "wrong-secret").update(body).digest("base64url");
    const res = await punchWithToken(`${body}.${sig}`);
    expect(res.statusCode).to.equal(400);
  });
});

describe("Kiosk auth header gate (rejects before any DB access)", () => {
  const runAuth = async (headers) => {
    const req = mockReq({ headers });
    const res = mockRes();
    let nextCalled = false;
    await kioskAuth(req, res, () => {
      nextCalled = true;
    });
    return { res, nextCalled };
  };

  it("rejects a missing credential pair with 401", async () => {
    const { res, nextCalled } = await runAuth({});
    expect(res.statusCode).to.equal(401);
    expect(nextCalled).to.equal(false);
  });

  it("rejects a missing key with 401", async () => {
    const { res, nextCalled } = await runAuth({ "x-kiosk-id": KIOSK_ID });
    expect(res.statusCode).to.equal(401);
    expect(nextCalled).to.equal(false);
  });

  const malformed = [
    ["kioskId with a space", { "x-kiosk-id": "bad id", "x-kiosk-key": KIOSK_KEY }],
    ["kioskId with path traversal", { "x-kiosk-id": "../../etc", "x-kiosk-key": KIOSK_KEY }],
    ["kioskId over 64 chars", { "x-kiosk-id": "k".repeat(65), "x-kiosk-key": KIOSK_KEY }],
    ["key with spaces", { "x-kiosk-id": KIOSK_ID, "x-kiosk-key": "not a valid key" }],
    ["key over 128 chars", { "x-kiosk-id": KIOSK_ID, "x-kiosk-key": "k".repeat(129) }],
    ["key shaped like a query operator", { "x-kiosk-id": KIOSK_ID, "x-kiosk-key": '{"$ne":null}' }],
  ];

  for (const [label, headers] of malformed) {
    it(`rejects ${label} with 401 before any query`, async () => {
      const { res, nextCalled } = await runAuth(headers);
      expect(res.statusCode).to.equal(401);
      expect(nextCalled).to.equal(false);
    });
  }
});

describe("Google Sheets removal invariants", () => {
  it("no longer registers the GoogleSheetsConnector model", () => {
    expect(mongoose.modelNames()).to.not.include("GoogleSheetsConnector");
  });

  it("no longer ships the attendance sync service", async () => {
    let failure = null;
    try {
      await import("../services/attendanceSyncService.js");
    } catch (err) {
      failure = err;
    }
    expect(failure, "attendanceSyncService.js should no longer exist").to.not.equal(null);
  });

  it("no longer exposes a google config block", () => {
    expect(config.google).to.equal(undefined);
  });
});

/**
 * NOTE: the cases in this block are intentionally SEQUENTIAL — they walk the
 * same member through check-in → duplicate-guard → check-out → already-completed
 * against one in-memory replica set (mocha runs them in declaration order).
 */
describe("Kiosk punch integration — zero third-party I/O + fail-closed paths", function () {
  this.timeout(60000);

  let mongoServer;
  let branch;
  let maleMember;
  let femaleMember;
  const noop = () => {};

  // Flip the duplicate-punch window between cases. The guard measures from the
  // attendance document's immutable createdAt, so the window is the only knob.
  async function setDuplicateWindow(seconds) {
    await SystemSettings.updateOne({ key: "gym_rules" }, { $set: { duplicatePunchSeconds: seconds } });
    systemSettingsService.invalidateCache();
  }

  before(async function () {
    // Guard against a connection left behind by another suite in this process.
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }

    mongoServer = await MongoMemoryServer.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    await mongoose.connect(mongoServer.getUri(), { dbName: "gym_kiosk_hardening" });

    branch = await seedTestBranch();

    await Kiosk.create({ kioskId: KIOSK_ID, name: "Hardening Kiosk", scope: "male", enabled: true, branchId: branch._id });

    await DeviceRegistration.create({
      registrationId: crypto.randomUUID(),
      kioskId: KIOSK_ID,
      trainerId: new mongoose.Types.ObjectId(),
      browserDeviceId: "hardening-browser",
      active: true,
      apiKeyHash: await bcrypt.hash(KIOSK_KEY, 10),
      keyFingerprint: crypto.createHash("sha256").update(KIOSK_KEY).digest("hex"),
      activatedAt: new Date(),
    });

    // Always-open window: isWithinBusinessHours is a linear comparison
    // (open <= now <= close), so 00:00-23:59 is open at every minute of the day.
    // invalidateCache() discards settings cached by an earlier suite.
    await SystemSettings.findOneAndUpdate(
      { key: "gym_rules" },
      { key: "gym_rules", openingTime: "00:00", closingTime: "23:59" },
      { upsert: true, new: true }
    );
    systemSettingsService.invalidateCache();

    const baseMember = (overrides) => ({
      fullName: "Hardening Member",
      branchId: branch._id,
      fatherName: "Test Father",
      dob: new Date("1995-01-01"),
      bloodGroup: "O+",
      gender: "Male",
      address: "Test Address",
      occupation: "Student",
      aadhar: String(100000000000 + Math.floor(Math.random() * 800000000000)),
      phone: `9${String(7000000000 + Math.floor(Math.random() * 999999999)).slice(0, 9)}`,
      gymPlan: "1 Month",
      trainingType: "Weight Loss",
      paymentStatus: "paid",
      status: "active",
      validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ...overrides,
    });

    maleMember = await Member.create(baseMember({ gymId: 777, memberCode: "M0777" }));
    femaleMember = await Member.create(
      baseMember({
        gymId: 778,
        memberCode: "F0778",
        gender: "Female",
        phone: `9${String(8000000000 + Math.floor(Math.random() * 999999999)).slice(0, 9)}`,
      })
    );
  });

  after(async function () {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect().catch(() => {});
    }
    if (mongoServer) await mongoServer.stop();
  });

  it("authenticates a valid credential and attaches the server-derived scope", async () => {
    const req = mockReq();
    let called = false;
    await kioskAuth(req, mockRes(), () => {
      called = true;
    });
    expect(called).to.equal(true);
    expect(req.kiosk.scope).to.equal("male");
  });

  it("completes a punch while fetch/http/https are poisoned → zero third-party I/O", async () => {
    const originalFetch = globalThis.fetch;
    const originalHttpRequest = http.request;
    const originalHttpsRequest = https.request;
    let externalAttempts = 0;
    const poison = () => {
      externalAttempts += 1;
      throw new Error("EXTERNAL I/O ON PUNCH PATH");
    };

    globalThis.fetch = poison;
    http.request = poison;
    https.request = poison;

    try {
      const req = mockReq({ body: { input: String(maleMember.gymId) } });
      await kioskAuth(req, mockRes(), noop);

      const res = mockRes();
      await kioskPunch(req, res);

      expect(res.body.status).to.equal("success");
      expect(res.body.member.gymId).to.equal(maleMember.gymId);
      expect(res.body.isCheckOut).to.equal(false);
      expect(externalAttempts, "punch path must not perform third-party I/O").to.equal(0);
    } finally {
      globalThis.fetch = originalFetch;
      http.request = originalHttpRequest;
      https.request = originalHttpsRequest;
    }
  });

  it("blocks an immediate second punch with 429 (duplicate-punch window)", async () => {
    const req = mockReq({ body: { input: String(maleMember.gymId) } });
    await kioskAuth(req, mockRes(), noop);
    const res = mockRes();
    await kioskPunch(req, res);
    expect(res.statusCode).to.equal(429);
    expect(res.body.status).to.equal("rate_limited");
  });

  it("checks out atomically once the duplicate window is relaxed", async () => {
    await setDuplicateWindow(0);

    const req = mockReq({ body: { input: String(maleMember.gymId) } });
    await kioskAuth(req, mockRes(), noop);
    const res = mockRes();
    await kioskPunch(req, res);

    expect(res.body.status).to.equal("success");
    expect(res.body.isCheckOut).to.equal(true);
  });

  it("rejects a further punch the same day with 409 (already completed)", async () => {
    const req = mockReq({ body: { input: String(maleMember.gymId) } });
    await kioskAuth(req, mockRes(), noop);
    const res = mockRes();
    await kioskPunch(req, res);
    expect(res.statusCode).to.equal(409);
    expect(res.body.status).to.equal("already_checked_out");
  });

  it("hides an out-of-scope member as not_found (no cross-gender leak)", async () => {
    const req = mockReq({ body: { input: String(femaleMember.gymId) } });
    await kioskAuth(req, mockRes(), noop);
    const res = mockRes();
    await kioskPunch(req, res);
    expect(res.statusCode).to.equal(404);
    expect(res.body.status).to.equal("not_found");
  });

  it("rejects a valid-shape but unknown credential with 401", async () => {
    const req = mockReq({
      headers: { "x-kiosk-id": KIOSK_ID, "x-kiosk-key": crypto.randomBytes(32).toString("base64url") },
    });
    const res = mockRes();
    let called = false;
    await kioskAuth(req, res, () => {
      called = true;
    });
    expect(res.statusCode).to.equal(401);
    expect(called).to.equal(false);
  });

});



