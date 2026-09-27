// tests/financeReconcile.test.js — Nightly financial reconciliation & DailySummary self-healing.
process.env.TZ = "Asia/Kolkata";

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { expect } from "chai";

import "../models/Member.js";
import "../models/PaymentLog.js";
import "../models/FinanceLog.js";
import "../models/DailySummary.js";
import "../models/Diet.js";

import Member from "../models/Member.js";
import FinanceLog from "../models/FinanceLog.js";
import DailySummary from "../models/DailySummary.js";
import {
  rebuildSummaryForDate,
  rebuildTodaySummary,
  rebuildLastSevenDays,
  reconcileDailySummaries,
  startOfDay,
  dayWindow,
  businessDateKey
} from "../services/summaryService.js";
import { executeFinanceReconciliation } from "../jobs/financeReconcileJob.js";
import { CRON_CONFIG } from "../config/cronConfig.js";
import { paymentController } from "../controllers/paymentController.js";
import { seedTestBranch } from "./utils/branchFixture.js";

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

// Simulates a database failure for ONE business day's FinanceLog query so
// per-day error isolation can be asserted against a real throw: a single bad
// day must never abort the rest of the window. Returns a restore function.
const patchFinanceFindForDay = (targetDate) => {
  const { start } = dayWindow(targetDate);
  const failingStart = start.getTime();
  const originalFind = FinanceLog.find;
  const ownDescriptor = Object.getOwnPropertyDescriptor(FinanceLog, "find");

  FinanceLog.find = function (query) {
    const queryStart = query?.date?.$gte;
    if (queryStart instanceof Date && queryStart.getTime() === failingStart) {
      throw new Error("simulated DB failure");
    }
    return originalFind.apply(this, arguments);
  };

  return () => {
    if (ownDescriptor) Object.defineProperty(FinanceLog, "find", ownDescriptor);
    else delete FinanceLog.find;
  };
};

describe("Financial Reconciliation & DailySummary Self-Healing", function () {
  this.timeout(60000);

  let mongoServer;
  let branch;

  before(async function () {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { dbName: "gym_reconcile_test" });
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
      FinanceLog.deleteMany({}),
      DailySummary.deleteMany({}),
    ]);
  });
  describe("Date Windowing & Business Date Key", () => {
    it("runs with the IST process timezone pinned (consistent on UTC CI runners)", () => {
      expect(process.env.TZ).to.equal("Asia/Kolkata");
      // Asia/Kolkata is UTC+05:30 → getTimezoneOffset() returns -330 minutes.
      expect(new Date().getTimezoneOffset()).to.equal(-330);
      expect(CRON_CONFIG.timezone).to.equal("Asia/Kolkata");
    });

    it("computes startOfDay and dayWindow consistently in Asia/Kolkata", () => {
      const target = new Date("2026-05-15T14:30:00.000Z");
      const start = startOfDay(target);
      const { start: wStart, end: wEnd } = dayWindow(target);

      expect(start.getHours()).to.equal(0);
      expect(start.getMinutes()).to.equal(0);
      expect(start.getSeconds()).to.equal(0);

      expect(wStart.getTime()).to.equal(start.getTime());
      expect(wEnd.getTime() - wStart.getTime()).to.equal(24 * 60 * 60 * 1000);

      const key = businessDateKey(target);
      expect(key).to.match(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("rebuildSummaryForDate", () => {
    it("accurately aggregates revenue, plans, training types, and active members", async () => {
      const target = new Date();
      const { start } = dayWindow(target);

      await FinanceLog.create([
        {
          branchId: branch._id,
          gymId: 101,
          memberName: "Alice",
          amount: 3000,
          plan: "1 Month",
          trainingType: "Weight Loss",
          type: "new",
          date: new Date(start.getTime() + 2 * 3600 * 1000)
        },
        {
          branchId: branch._id,
          gymId: 102,
          memberName: "Bob",
          amount: 6000,
          plan: "3 Months",
          trainingType: "Weight Gain",
          type: "renew",
          date: new Date(start.getTime() + 4 * 3600 * 1000)
        }
      ]);

      await Member.create({
        branchId: branch._id,
        gymId: 101,
        memberCode: "M0101",
        fullName: "Alice",
        fatherName: "Father",
        phone: "9876543210",
        aadhar: "123456789012",
        dob: new Date("1995-01-01"),
        bloodGroup: "O+",
        address: "Test Address",
        occupation: "Engineer",
        gender: "Female",
        gymPlan: "1 Month",
        trainingType: "Weight Loss",
        paymentStatus: "paid",
        createdAt: new Date(start.getTime() + 2 * 3600 * 1000)
      });

      const summary = await rebuildSummaryForDate(target, branch._id);

      expect(summary.totalRevenue).to.equal(9000);
      expect(summary.newJoiningRevenue).to.equal(3000);
      expect(summary.renewalRevenue).to.equal(6000);
      expect(summary.totalTransactions).to.equal(2);
      expect(summary.incomeByPlan.get("1 Month")).to.equal(3000);
      expect(summary.incomeByPlan.get("3 Months")).to.equal(6000);
      expect(summary.incomeByTrainingType.get("Weight Loss")).to.equal(3000);
      expect(summary.incomeByTrainingType.get("Weight Gain")).to.equal(6000);
      expect(summary.membersByTrainingType.get("Weight Loss")).to.equal(1);
      expect(summary.lastUpdatedAt).to.be.instanceOf(Date);
    });

    it("rebuildTodaySummary accepts an explicit target date inside the lookback window", async () => {
      const past = new Date();
      past.setDate(past.getDate() - 2);
      const { start } = dayWindow(past);

      await FinanceLog.create({
        branchId: branch._id,
        gymId: 103,
        memberName: "Hank",
        amount: 1200,
        plan: "1 Month",
        trainingType: "Weight Gain",
        type: "new",
        date: new Date(start.getTime() + 3600000)
      });

      const summary = await rebuildTodaySummary(past, branch._id);

      expect(summary.date.getTime()).to.equal(start.getTime());
      expect(summary.totalRevenue).to.equal(1200);
      expect(summary.totalTransactions).to.equal(1);
      expect(summary.membersByTrainingType).to.be.instanceOf(Map);
      expect(summary.lastUpdatedAt).to.be.instanceOf(Date);
    });
  });

  describe("reconcileDailySummaries (Self-Healing Drift Audit)", () => {
    it("detects drift when DailySummary totalRevenue differs from FinanceLog sums", async () => {
      const target = new Date();
      const { start } = dayWindow(target);

      await DailySummary.create({
        branchId: branch._id,
        date: start,
        totalRevenue: 5000,
        totalTransactions: 1,
        newJoiningRevenue: 5000,
        renewalRevenue: 0,
        lastUpdatedAt: new Date(Date.now() - 3600000)
      });

      await FinanceLog.create([
        {
          branchId: branch._id,
          gymId: 201,
          memberName: "Charlie",
          amount: 8000,
          plan: "6 Months",
          trainingType: "Transformation",
          type: "new",
          date: new Date(start.getTime() + 3600000)
        }
      ]);

      const report = await reconcileDailySummaries({
        lookbackDays: 1,
        driftAlertThreshold: 0.01,
        branchId: branch._id
      });

      expect(report.processedDays).to.equal(1);
      expect(report.driftDetectedCount).to.equal(1);
      expect(report.totalDrift).to.equal(3000);
      expect(report.details[0].hadSummary).to.equal(true);
      expect(report.details[0].previousRevenue).to.equal(5000);
      expect(report.details[0].newRevenue).to.equal(8000);
      expect(report.details[0].delta).to.equal(3000);

      const healedSummary = await DailySummary.findOne({ date: start });
      expect(healedSummary.totalRevenue).to.equal(8000);
      expect(healedSummary.totalTransactions).to.equal(1);
    });

    it("creates a missing DailySummary during reconciliation", async () => {
      const target = new Date();
      const { start } = dayWindow(target);

      await FinanceLog.create({
        branchId: branch._id,
        gymId: 202,
        memberName: "Dave",
        amount: 4000,
        plan: "1 Month",
        trainingType: "Weight Loss",
        type: "new",
        date: new Date(start.getTime() + 3600000)
      });

      const report = await reconcileDailySummaries({
        lookbackDays: 1,
        branchId: branch._id
      });

      expect(report.processedDays).to.equal(1);
      expect(report.createdCount).to.equal(1);
      expect(report.details[0].hadSummary).to.equal(false);
      expect(report.details[0].newRevenue).to.equal(4000);

      const created = await DailySummary.findOne({ date: start });
      expect(created).to.not.equal(null);
      expect(created.totalRevenue).to.equal(4000);
    });
  });

  describe("Per-day Error Isolation", () => {
    it("rebuilds every day of the window when no failure occurs", async () => {
      const results = await rebuildLastSevenDays(3, branch._id);
      expect(results).to.be.an("array").with.lengthOf(3);
      for (const res of results) {
        expect(res.ok).to.equal(true);
      }
    });

    it("rebuildLastSevenDays records the failing day and still rebuilds the rest", async () => {
      const failingDay = new Date();
      failingDay.setDate(failingDay.getDate() - 1);

      const restore = patchFinanceFindForDay(failingDay);
      try {
        const results = await rebuildLastSevenDays(3, branch._id);

        expect(results).to.have.lengthOf(3);
        expect(results.filter((r) => r.ok)).to.have.lengthOf(2);

        const failed = results.filter((r) => !r.ok);
        expect(failed).to.have.lengthOf(1);
        expect(failed[0].date).to.equal(businessDateKey(failingDay));
        expect(failed[0].error).to.match(/simulated DB failure/);
      } finally {
        restore();
      }
    });

    it("reconcileDailySummaries isolates a corrupt day and still heals the others", async () => {
      const target = new Date();
      const { start } = dayWindow(target);
      const failingDay = new Date();
      failingDay.setDate(failingDay.getDate() - 1);

      // Today's stored summary is wrong and must still be healed, even though
      // yesterday's rebuild throws mid-run.
      await DailySummary.create({
        branchId: branch._id,
        date: start,
        totalRevenue: 100,
        totalTransactions: 1,
        newJoiningRevenue: 100,
        renewalRevenue: 0,
        lastUpdatedAt: new Date(Date.now() - 3600000)
      });
      await FinanceLog.create({
        branchId: branch._id,
        gymId: 401,
        memberName: "Frank",
        amount: 4500,
        plan: "3 Months",
        trainingType: "Weight Loss",
        type: "renew",
        date: new Date(start.getTime() + 3600000)
      });

      const restore = patchFinanceFindForDay(failingDay);
      let report;
      try {
        report = await reconcileDailySummaries({
          lookbackDays: 3,
          driftAlertThreshold: 0.01,
          branchId: branch._id
        });
      } finally {
        restore();
      }

      expect(report.processedDays).to.equal(2);
      expect(report.details).to.have.lengthOf(2);
      expect(report.errors).to.have.lengthOf(1);
      expect(report.errors[0].date).to.equal(businessDateKey(failingDay));
      expect(report.errors[0].error).to.match(/simulated DB failure/);
      expect(report.driftDetectedCount).to.equal(1);

      const healed = await DailySummary.findOne({ date: start });
      expect(healed.totalRevenue).to.equal(4500);
      expect(healed.totalTransactions).to.equal(1);
      expect(healed.lastUpdatedAt).to.be.instanceOf(Date);
      expect(healed.membersByTrainingType).to.be.instanceOf(Map);
    });
  });

  describe("executeFinanceReconciliation (cron/admin job entry point)", () => {
    it("exposes sane defaults from CRON_CONFIG", () => {
      const jobConfig = CRON_CONFIG.jobs.financialReconciliation;
      expect(jobConfig.enabled).to.equal(true);
      expect(jobConfig.schedule).to.equal("30 3 * * *");
      expect(jobConfig.lookbackDays).to.equal(7);
      expect(jobConfig.driftAlertThreshold).to.equal(0.01);
      expect(CRON_CONFIG.timezone).to.equal("Asia/Kolkata");
    });

    it("uses the configured lookback window and reports the drift it corrected", async () => {
      const jobConfig = CRON_CONFIG.jobs.financialReconciliation;
      const target = new Date();
      const { start } = dayWindow(target);

      await DailySummary.create({
        branchId: branch._id,
        date: start,
        totalRevenue: 5000,
        totalTransactions: 1,
        newJoiningRevenue: 5000,
        renewalRevenue: 0,
        lastUpdatedAt: new Date(Date.now() - 3600000)
      });
      await FinanceLog.create({
        branchId: branch._id,
        gymId: 501,
        memberName: "Grace",
        amount: 8000,
        plan: "6 Months",
        trainingType: "Transformation",
        type: "new",
        date: new Date(start.getTime() + 3600000)
      });

      const report = await executeFinanceReconciliation();

      expect(report.lookbackDays).to.equal(jobConfig.lookbackDays);
      expect(report.processedDays).to.equal(jobConfig.lookbackDays);
      expect(report.errors).to.have.lengthOf(0);
      expect(report.driftDetectedCount).to.equal(1);
      expect(report.totalDrift).to.equal(3000);

      const healed = await DailySummary.findOne({ date: start });
      expect(healed.totalRevenue).to.equal(8000);
      expect(healed.lastUpdatedAt).to.be.instanceOf(Date);
      expect(healed.membersByTrainingType).to.be.instanceOf(Map);
    });

    it("accepts an overridden (narrowed) window", async () => {
      const report = await executeFinanceReconciliation({ lookbackDays: 2 });
      expect(report.lookbackDays).to.equal(2);
      expect(report.processedDays).to.equal(2);
    });
  });

  describe("POST /api/finance/reconcile Controller Handler", () => {
    it("allows superadmin to trigger on-demand reconciliation", async () => {
      const target = new Date();
      const { start } = dayWindow(target);

      await FinanceLog.create({
        branchId: branch._id,
        gymId: 301,
        memberName: "Eve",
        amount: 2500,
        plan: "1 Month",
        trainingType: "Weight Gain",
        type: "new",
        date: new Date(start.getTime() + 1800000)
      });

      const req = {
        body: { lookbackDays: 2 },
        query: {},
        admin: { role: "superadmin" }
      };

      const res = await runHandler(paymentController.reconcileFinance, req);

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(res.body.data.processedDays).to.equal(2);

      const summary = await DailySummary.findOne({ date: start });
      expect(summary.totalRevenue).to.equal(2500);
    });
  });
});

