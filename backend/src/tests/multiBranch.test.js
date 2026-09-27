/**
 * Multi-branch tenancy — the correctness boundaries added by the refactor:
 *
 *   1. BRANCH IDENTITY: the same gymId / phone may exist in two branches;
 *      repository lookups are branch-scoped when a branchId is supplied.
 *   2. COMPOUND UNIQUENESS: {branchId, gender, gymId} and {branchId, phone}
 *      are unique WITHIN a branch and free ACROSS branches.
 *   3. PUBLIC LOOKUP AMBIGUITY: an unscoped keypad/phone lookup that matches
 *      several branches returns "ambiguous", never an arbitrary member;
 *      both aliases (x-branch-id header, ?branchId=) resolve the same way.
 *   4. BRANCH CONTEXT GUARD: branchContext fails closed for admins without a
 *      branch and rejects every trainer DELETE in one place.
 *   5. PER-BRANCH RECONCILIATION: nightly reconciliation walks every active
 *      branch and each DailySummary holds only its own branch's revenue.
 *
 * Self-contained on a mongodb-memory-server replica set.
 */
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { expect } from "chai";

import Member from "../models/Member.js";
import "../models/Diet.js";
import FinanceLog from "../models/FinanceLog.js";
import DailySummary from "../models/DailySummary.js";
import memberRepository from "../repositories/memberRepository.js";
import { memberController } from "../controllers/memberController.js";
import branchContext, {
  NO_BRANCH_MESSAGE,
  TRAINER_DELETE_MESSAGE,
} from "../middleware/branchContext.js";
import { reconcileDailySummaries, startOfDay } from "../services/summaryService.js";
import { seedTestBranch, seedSecondBranch } from "./utils/branchFixture.js";

const baseMember = (overrides) => ({
  fullName: "Tenancy Member",
  fatherName: "Test Father",
  dob: new Date("1990-01-01"),
  bloodGroup: "O+",
  gender: "Male",
  address: "Test Address",
  occupation: "Student",
  aadhar: String(100000000000 + Math.floor(Math.random() * 900000000000)),
  phone: `9${String(7000000000 + Math.floor(Math.random() * 2000000000))}`.slice(0, 10),
  gymPlan: "1 Month",
  trainingType: "Weight Loss",
  paymentStatus: "paid",
  status: "active",
  validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  ...overrides,
});

const catchError = async (fn) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
};

const validityReq = ({ gymId, phone, branchHeader, branchQuery } = {}) => ({
  params: gymId ? { gymId: String(gymId) } : {},
  query: {
    ...(phone ? { phone } : {}),
    ...(branchQuery ? { branchId: String(branchQuery) } : {}),
  },
  get(name) {
    return String(name).toLowerCase() === "x-branch-id" ? branchHeader : undefined;
  },
});

const mockRes = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

describe("Multi-branch tenancy (integration)", function () {
  this.timeout(60000);

  let mongoServer;
  let branchA;
  let branchB;
  let memberA;
  let memberB;

  before(async function () {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }
    mongoServer = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    await mongoose.connect(mongoServer.getUri(), { dbName: "gym_multibranch" });

    branchA = await seedTestBranch();
    branchB = await seedSecondBranch();

    // Build the compound unique indexes before any uniqueness assertion.
    await Member.init();

    // The SAME gymId and the SAME phone exist in BOTH branches — this is the
    // per-branch identity contract the whole suite leans on.
    memberA = await Member.create(
      baseMember({
        fullName: "Branch A Member",
        branchId: branchA._id,
        gender: "Male",
        gymId: 5000,
        phone: "9876500001",
        memberCode: "M0500",
      })
    );
    memberB = await Member.create(
      baseMember({
        fullName: "Branch B Member",
        branchId: branchB._id,
        gender: "Male",
        gymId: 5000,
        phone: "9876500001",
        memberCode: "M0501",
      })
    );
  });

  after(async function () {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    if (mongoServer) await mongoServer.stop();
  });

  /* ── 1. Branch identity ─────────────────────────────────────────────── */

  it("stores the same gymId and phone independently in two branches", async () => {
    expect(String(memberA._id)).to.not.equal(String(memberB._id));
    expect(memberA.gymId).to.equal(memberB.gymId);
    expect(memberA.phone).to.equal(memberB.phone);
    expect(String(memberA.branchId)).to.equal(String(branchA._id));
    expect(String(memberB.branchId)).to.equal(String(branchB._id));
  });

  it("scopes repository lookups when a branchId is provided", async () => {
    const inA = await memberRepository.findAllByGymId(5000, branchA._id);
    expect(inA).to.have.length(1);
    expect(String(inA[0]._id)).to.equal(String(memberA._id));

    const inB = await memberRepository.findAllByGymId(5000, branchB._id);
    expect(inB).to.have.length(1);
    expect(String(inB[0]._id)).to.equal(String(memberB._id));

    const unscoped = await memberRepository.findAllByGymId(5000, null);
    expect(unscoped).to.have.length(2);
  });

  it("scopes phone lookups when a branchId is provided", async () => {
    const inA = await memberRepository.findAllByPhone("9876500001", branchA._id);
    expect(inA).to.have.length(1);
    expect(String(inA[0]._id)).to.equal(String(memberA._id));

    const inB = await memberRepository.findAllByPhone("9876500001", branchB._id);
    expect(inB).to.have.length(1);
    expect(String(inB[0]._id)).to.equal(String(memberB._id));

    const unscoped = await memberRepository.findAllByPhone("9876500001", null);
    expect(unscoped).to.have.length(2);
  });

  /* ── 2. Compound uniqueness ─────────────────────────────────────────── */

  it("rejects a duplicate {branchId, gender, gymId} within one branch", async () => {
    // First occupant of (branchA, Male, 501) is legal.
    await Member.create(
      baseMember({
        fullName: "Male Gym 501",
        branchId: branchA._id,
        gender: "Male",
        gymId: 501,
        phone: "9876500002",
        memberCode: "M0502",
      })
    );

    const dup = await catchError(() =>
      Member.create(
        baseMember({
          branchId: branchA._id,
          gender: "Male",
          gymId: 501,
          phone: "9876500012",
          memberCode: "M0512",
        })
      )
    );
    expect(dup, "in-branch duplicate gymId must fail").to.exist;
    expect(dup.code).to.equal(11000);

    // The same gymId with a DIFFERENT gender in the SAME branch is distinct.
    const otherGender = await Member.create(
      baseMember({
        fullName: "Female Gym 501",
        branchId: branchA._id,
        gender: "Female",
        gymId: 501,
        phone: "9876500003",
        memberCode: "F0501",
      })
    );
    expect(otherGender).to.exist;
  });

  it("rejects a duplicate {branchId, phone} within one branch", async () => {
    await Member.create(
      baseMember({
        fullName: "Phone Owner",
        branchId: branchA._id,
        gender: "Male",
        gymId: 502,
        phone: "9876500004",
        memberCode: "M0503",
      })
    );

    const dup = await catchError(() =>
      Member.create(
        baseMember({
          branchId: branchA._id,
          gender: "Male",
          gymId: 503,
          phone: "9876500004",
          memberCode: "M0504",
        })
      )
    );
    expect(dup, "in-branch duplicate phone must fail").to.exist;
    expect(dup.code).to.equal(11000);

    // The same phone in the OTHER branch remains legal.
    const crossBranch = await Member.create(
      baseMember({
        fullName: "Cross Branch Phone",
        branchId: branchB._id,
        gender: "Male",
        gymId: 503,
        phone: "9876500004",
        memberCode: "M0505",
      })
    );
    expect(crossBranch).to.exist;
  });

  /* ── 3. Public lookup ambiguity + both branch aliases ───────────────── */

  it("an unscoped gymId lookup across branches returns ambiguous", async () => {
    const res = mockRes();
    await memberController.checkPublicValidity(validityReq({ gymId: 5000 }), res, () => {});
    expect(res.body.success).to.equal(true);
    expect(res.body.data.found).to.equal(false);
    expect(res.body.data.status).to.equal("ambiguous");
    expect(res.body.data.message).to.equal("Multiple members found across branches.");
  });

  it("resolves a gymId lookup via the x-branch-id header", async () => {
    const resA = mockRes();
    await memberController.checkPublicValidity(
      validityReq({ gymId: 5000, branchHeader: String(branchA._id) }),
      resA,
      () => {}
    );
    expect(resA.body.data.found).to.equal(true);
    expect(resA.body.data.name).to.match(/^Branch A Member/);

    const resB = mockRes();
    await memberController.checkPublicValidity(
      validityReq({ gymId: 5000, branchHeader: String(branchB._id) }),
      resB,
      () => {}
    );
    expect(resB.body.data.found).to.equal(true);
    expect(resB.body.data.name).to.match(/^Branch B Member/);
  });

  it("resolves a gymId lookup via the ?branchId= query alias", async () => {
    const res = mockRes();
    await memberController.checkPublicValidity(
      validityReq({ gymId: 5000, branchQuery: branchB._id }),
      res,
      () => {}
    );
    expect(res.body.data.found).to.equal(true);
    expect(res.body.data.name).to.match(/^Branch B Member/);
  });

  it("an unscoped phone lookup across branches returns ambiguous", async () => {
    const res = mockRes();
    await memberController.checkPublicValidity(
      validityReq({ phone: "9876500001" }),
      res,
      () => {}
    );
    expect(res.body.data.found).to.equal(false);
    expect(res.body.data.status).to.equal("ambiguous");
    expect(res.body.data.message).to.equal("Multiple members found across branches.");
  });

  it("resolves a phone lookup via the x-branch-id header", async () => {
    const res = mockRes();
    await memberController.checkPublicValidity(
      validityReq({ phone: "9876500001", branchHeader: String(branchA._id) }),
      res,
      () => {}
    );
    expect(res.body.data.found).to.equal(true);
    expect(res.body.data.name).to.match(/^Branch A Member/);
  });

  /* ── 4. Branch context guard ────────────────────────────────────────── */

  it("attaches branch context for a superadmin DELETE", () => {
    const req = { admin: { role: "superadmin", branchId: branchA._id }, method: "DELETE" };
    let nextCalled = false;
    branchContext(req, mockRes(), () => {
      nextCalled = true;
    });
    expect(nextCalled).to.equal(true);
    expect(String(req.branchId)).to.equal(String(branchA._id));
  });

  it("blocks every trainer DELETE with 403", () => {
    const req = { admin: { role: "trainer", branchId: branchA._id }, method: "DELETE" };
    const res = mockRes();
    let nextCalled = false;
    branchContext(req, res, () => {
      nextCalled = true;
    });
    expect(res.statusCode).to.equal(403);
    expect(res.body.message).to.equal(TRAINER_DELETE_MESSAGE);
    expect(nextCalled).to.equal(false);
  });

  it("allows trainer non-DELETE requests", () => {
    const req = { admin: { role: "trainer", branchId: branchA._id }, method: "GET" };
    let nextCalled = false;
    branchContext(req, mockRes(), () => {
      nextCalled = true;
    });
    expect(nextCalled).to.equal(true);
    expect(String(req.branchId)).to.equal(String(branchA._id));
  });

  it("fails closed for an authenticated admin without a branch", () => {
    const req = { admin: { role: "superadmin" }, method: "GET" };
    const res = mockRes();
    let nextCalled = false;
    branchContext(req, res, () => {
      nextCalled = true;
    });
    expect(res.statusCode).to.equal(403);
    expect(res.body.message).to.equal(NO_BRANCH_MESSAGE);
    expect(nextCalled).to.equal(false);
  });

  it("is a no-op when there is no admin principal", () => {
    const req = { method: "GET" };
    let nextCalled = false;
    branchContext(req, mockRes(), () => {
      nextCalled = true;
    });
    expect(nextCalled).to.equal(true);
    expect(req.branchId).to.equal(undefined);
  });

  /* ── 5. Per-branch reconciliation ───────────────────────────────────── */

  it("reconciles every active branch independently", async () => {
    const now = new Date();
    await FinanceLog.create([
      {
        branchId: branchA._id,
        gymId: 5000,
        memberName: "Branch A Member",
        amount: 100,
        plan: "1 Month",
        trainingType: "Weight Loss",
        type: "new",
        date: now,
      },
      {
        branchId: branchB._id,
        gymId: 5000,
        memberName: "Branch B Member",
        amount: 250,
        plan: "3 Months",
        trainingType: "Weight Gain",
        type: "renew",
        date: now,
      },
    ]);

    const report = await reconcileDailySummaries({ lookbackDays: 1 });

    expect(report.errors).to.deep.equal([]);
    expect(report.branchesProcessed).to.equal(2);
    expect(report.processedDays).to.equal(2);

    const todayStart = startOfDay(now);
    const summaryA = await DailySummary.findOne({ branchId: branchA._id, date: todayStart }).lean();
    const summaryB = await DailySummary.findOne({ branchId: branchB._id, date: todayStart }).lean();

    expect(summaryA, "branch A must have its own DailySummary").to.exist;
    expect(summaryB, "branch B must have its own DailySummary").to.exist;
    // Each summary holds ONLY its own branch's revenue — no cross-branch leak.
    expect(summaryA.totalRevenue).to.equal(100);
    expect(summaryA.totalTransactions).to.equal(1);
    expect(summaryB.totalRevenue).to.equal(250);
    expect(summaryB.totalTransactions).to.equal(1);
  });
});
