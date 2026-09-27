// tests/renewalAtomicity.test.js — P0 financial drift guards for renewMember.
//
// renewMember moves money: it extends a member, writes FinanceLog + PaymentLog
// and updates the pre-aggregated DailySummary. All four must commit or roll
// back together, otherwise the member is extended while the revenue is recorded
// nowhere. updateMember must never be able to write billing fields directly.
//
// renewMember uses a mongoose transaction, so this suite needs a real replica
// set (MongoMemoryServer.create() boots a standalone and cannot transact).
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { expect } from "chai";

import "../models/Member.js";
import "../models/PaymentLog.js";
import "../models/FinanceLog.js";
import "../models/DailySummary.js";
// Member.dietId populates against Diet — register it so .populate() resolves.
import "../models/Diet.js";

import Member from "../models/Member.js";
import PaymentLog from "../models/PaymentLog.js";
import FinanceLog from "../models/FinanceLog.js";
import DailySummary from "../models/DailySummary.js";
import { memberController } from "../controllers/memberController.js";
import { memberRenewSchema } from "../schemas/memberSchema.js";
import { seedTestBranch } from "./utils/branchFixture.js";

// Minimal req/res harness — asyncHandler routes rejected promises to next().
const makeRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
};

const runHandler = async (handler, req) => {
  const res = makeRes();
  let error = null;
  await handler(req, res, (err) => { error = err; });
  if (error) throw error;
  return res;
};

const superAdminReq = (body, params = {}) => ({
  params,
  query: {},
  body,
  admin: { id: "admin-1", role: "superadmin", scope: "all" },
  logger: { error() {}, info() {}, warn() {} },
});

let gymIdSeq = 0;
let branch;

const makeMember = (overrides = {}) =>
  Member.create({
    branchId: branch._id,
    gymId: (gymIdSeq += 1),
    memberCode: `M${String(gymIdSeq).padStart(4, "0")}`,
    fullName: "Ravi Kumar",
    fatherName: "Suresh Kumar",
    phone: "9876543210",
    aadhar: "123456789012",
    dob: new Date("1995-05-05"),
    bloodGroup: "B+",
    address: "Test Street",
    occupation: "Trainer",
    gender: "Male",
    gymPlan: "3 Months",
    trainingType: "Weight Loss",
    medicalIssues: "None",
    paymentStatus: "paid",
    paymentMode: "cash",
    currentPaymentDate: new Date("2026-01-01"),
    validityEnd: new Date("2026-03-31"),
    status: "active",
    version: 0,
    ...overrides,
  });

const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

describe("P0 financial drift guards — renewMember / updateMember", function () {
  this.timeout(120000);

  let mongoServer;

  before(async function () {
    mongoServer = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    await mongoose.connect(mongoServer.getUri(), { dbName: "gym_test" });
    branch = await seedTestBranch();
  });

  after(async function () {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Member.deleteMany({}),
      PaymentLog.deleteMany({}),
      FinanceLog.deleteMany({}),
      DailySummary.deleteMany({}),
    ]);
  });


  // ── Criterion 1: atomic rollback ────────────────────────────────────────
  describe("renewMember transaction", () => {
    it("commits member + FinanceLog + PaymentLog + DailySummary together", async () => {
      const member = await makeMember();

      const res = await runHandler(
        memberController.renewMember,
        superAdminReq(
          {
            version: member.version,
            plan: "6 Months",
            price: 5000,
            paymentMode: "gpay",
            memberCode: member.memberCode,
          },
          { gymId: String(member.gymId) }
        )
      );

      expect(res.body.success).to.equal(true);

      const after = await Member.findById(member._id);
      expect(after.paymentStatus).to.equal("paid");
      expect(after.gymPlan).to.equal("6 Months");
      expect(after.validityEnd.getTime()).to.be.greaterThan(member.validityEnd.getTime());
      expect(after.version).to.equal(1);

      expect(await FinanceLog.countDocuments({ gymId: member.gymId })).to.equal(1);
      expect(await PaymentLog.countDocuments({ gymId: member.gymId })).to.equal(1);

      const summary = await DailySummary.findOne({ date: todayStart() });
      expect(summary).to.not.equal(null);
      expect(summary.totalRevenue).to.equal(5000);
      expect(summary.renewalRevenue).to.equal(5000);
      expect(summary.totalTransactions).to.equal(1);
    });

    it("rolls the member back when the FinanceLog write fails (invalid plan)", async () => {
      const member = await makeMember();
      const validityBefore = member.validityEnd;

      let thrown = null;
      try {
        await runHandler(
          memberController.renewMember,
          superAdminReq(
            {
              version: member.version,
              // "1 Year" is not in the FinanceLog plan enum -> the validation
              // error is raised AFTER the member has already been updated.
              newPlan: "1 Year",
              price: 5000,
              paymentMode: "cash",
              memberCode: member.memberCode,
            },
            { gymId: String(member.gymId) }
          )
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown, "expected the renewal to fail").to.not.equal(null);

      // The whole point: the member must NOT be extended.
      const after = await Member.findById(member._id);
      expect(after.validityEnd.getTime()).to.equal(validityBefore.getTime());
      expect(after.gymPlan).to.equal("3 Months");
      expect(after.version).to.equal(0, "version bump must be rolled back too");

      // And no orphan financial records.
      expect(await FinanceLog.countDocuments({ gymId: member.gymId })).to.equal(0);
      expect(await PaymentLog.countDocuments({ gymId: member.gymId })).to.equal(0);
    });

    it("rejects a stale version with 409 and changes nothing", async () => {
      const member = await makeMember();
      await Member.updateOne({ _id: member._id }, { $inc: { version: 1 } });

      let thrown = null;
      try {
        await runHandler(
          memberController.renewMember,
          superAdminReq(
            { version: 0, plan: "6 Months", price: 100, memberCode: member.memberCode },
            { gymId: String(member.gymId) }
          )
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown?.statusCode).to.equal(409);
      expect(await FinanceLog.countDocuments({})).to.equal(0);
      expect(await PaymentLog.countDocuments({})).to.equal(0);
    });

    it("404s a renewal for a member that does not exist", async () => {
      let thrown = null;
      try {
        await runHandler(
          memberController.renewMember,
          superAdminReq({ version: 0, plan: "6 Months", price: 100 }, { gymId: "999999" })
        );
      } catch (err) {
        thrown = err;
      }
      expect(thrown?.statusCode).to.equal(404);
    });
  });

  // ── Criterion 2: renewal must carry a positive amount ───────────────────
  describe("memberRenewSchema amount guard", () => {
    const check = (payload) => memberRenewSchema.validate(payload, { abortEarly: false }).error;

    it("rejects a renewal with neither amount nor price", () => {
      expect(check({ version: 0, plan: "6 Months" })).to.not.equal(undefined);
    });

    it("accepts amount", () => {
      expect(check({ version: 0, plan: "6 Months", amount: 500 })).to.equal(undefined);
    });

    it("accepts price", () => {
      expect(check({ version: 0, plan: "6 Months", price: 500 })).to.equal(undefined);
    });

    it("rejects a zero amount", () => {
      expect(check({ version: 0, plan: "6 Months", amount: 0 })).to.not.equal(undefined);
    });

    it("rejects a negative amount", () => {
      expect(check({ version: 0, plan: "6 Months", amount: -100 })).to.not.equal(undefined);
    });

    it("still requires the concurrency version", () => {
      expect(check({ plan: "6 Months", amount: 500 })).to.not.equal(undefined);
    });
  });

  // ── Criterion 3: mass-assignment guard ─────────────────────────────────
  describe("updateMember billing-field guard", () => {
    it("ignores paymentStatus / validityEnd / gymPlan in the update payload", async () => {
      const member = await makeMember();
      const originalValidity = member.validityEnd;

      await runHandler(
        memberController.updateMember,
        superAdminReq(
          {
            version: member.version,
            memberCode: member.memberCode,
            // A buggy or hostile client tries to grant membership for free.
            paymentStatus: "paid",
            paymentMode: "gpay",
            validityEnd: new Date("2030-01-01").toISOString(),
            gymPlan: "12 Months",
            // Legitimate profile field must still be applied.
            occupation: "Athlete",
          },
          { gymId: String(member.gymId) }
        )
      );

      const after = await Member.findById(member._id);
      expect(after.gymPlan, "gymPlan must not change via PUT").to.equal("3 Months");
      expect(after.paymentMode, "paymentMode must not change via PUT").to.equal("cash");
      expect(after.validityEnd.getTime(), "validityEnd must not change via PUT")
        .to.equal(originalValidity.getTime());
      // The guard must not be over-broad: the legitimate field is applied.
      expect(after.occupation).to.equal("Athlete");
    });

    it("still bumps the optimistic-concurrency version", async () => {
      const member = await makeMember();
      await runHandler(
        memberController.updateMember,
        superAdminReq(
          { version: member.version, memberCode: member.memberCode, occupation: "Coach" },
          { gymId: String(member.gymId) }
        )
      );
      const after = await Member.findById(member._id);
      expect(after.version).to.equal(1);
    });

    it("returns 409 when the version is stale", async () => {
      const member = await makeMember();
      await Member.updateOne({ _id: member._id }, { $inc: { version: 1 } });

      let thrown = null;
      try {
        await runHandler(
          memberController.updateMember,
          superAdminReq({ version: 0, memberCode: member.memberCode }, { gymId: String(member.gymId) })
        );
      } catch (err) {
        thrown = err;
      }
      expect(thrown?.statusCode).to.equal(409);
    });

    it("does not create any financial record for a profile edit", async () => {
      const member = await makeMember();
      await runHandler(
        memberController.updateMember,
        superAdminReq(
          { version: member.version, memberCode: member.memberCode, occupation: "Coach" },
          { gymId: String(member.gymId) }
        )
      );
      expect(await FinanceLog.countDocuments({})).to.equal(0);
      expect(await PaymentLog.countDocuments({})).to.equal(0);
      expect(await DailySummary.countDocuments({})).to.equal(0);
    });
  });
});

