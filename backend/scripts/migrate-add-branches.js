// scripts/migrate-add-branches.js — Operator-run multi-tenancy migration
//
// STEP 1 of the multi-branch refactor (docs/architecture/27-multi-branch-refactor.md).
//
// What it does (in order, each phase reported):
//   1. Seeds the default branch  { name: "Mathur Branch", code: "MATHUR" }.
//   2. Backfills `branchId` on every document missing it across the nine
//      tenant-scoped collections: Member, FinanceLog, PaymentLog, DailySummary,
//      Attendance, Package, Enquiry, Kiosk, Admin.
//      (Single-default-branch seeding: every pre-migration document belongs to
//      the default branch by definition, so a direct $set is exact — no join
//      through Member is needed or possible: FinanceLog has no gender field.)
//   3. Verifies the new compound-unique constraints would hold, then swaps the
//      superseded indexes:
//        members       {gymId,gender} unique  -> {branchId,gender,gymId} unique
//        members       phone unique (global)  -> {branchId,phone} unique
//        dailysummaries date unique           -> {branchId,date} unique
//        kiosks        kioskId unique         -> {branchId,kioskId} unique
//   4. Seeds the branch-scoped keypad counters (gym_id_MATHUR_M / _F) from the
//      default branch's current per-gender max gymId.
//
// SAFETY:
//   - Refuses to run unless MIGRATE_ADD_BRANCHES=1 (explicit operator action).
//   - Idempotent: re-running backfills nothing (branchId filter = null) and
//     re-creates no index that already exists with the right key.
//   - Aborts BEFORE any index change if duplicates would violate a new unique.
//   - Never modifies member gymId values, memberCodes, or legacy counters.
//
// Usage:
//   MIGRATE_ADD_BRANCHES=1 DATABASE_URL="<mongo uri>" node scripts/migrate-add-branches.js

import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

import Branch from "../src/models/Branch.js";
import Member from "../src/models/Member.js";
import FinanceLog from "../src/models/FinanceLog.js";
import PaymentLog from "../src/models/PaymentLog.js";
import DailySummary from "../src/models/DailySummary.js";
import Attendance from "../src/models/Attendance.js";
import Package from "../src/models/Package.js";
import Enquiry from "../src/models/Enquiry.js";
import Kiosk from "../src/models/Kiosk.js";
import Admin from "../src/models/Admin.js";
import Counter from "../src/services/atomicCounter.js";

export const DEFAULT_BRANCH = { name: "Mathur Branch", code: "MATHUR", isActive: true };

// All nine tenant-scoped collections, in dependency-safe order (members first
// so downstream join-based reporting can rely on Member.branchId being set).
const TENANT_COLLECTIONS = [
  { label: "Member", model: Member },
  { label: "Admin", model: Admin },
  { label: "Package", model: Package },
  { label: "Kiosk", model: Kiosk },
  { label: "Enquiry", model: Enquiry },
  { label: "DailySummary", model: DailySummary },
  { label: "Attendance", model: Attendance },
  { label: "FinanceLog", model: FinanceLog },
  { label: "PaymentLog", model: PaymentLog },
];

/** Upsert (or fetch) the default branch. Returns the Branch document. */
export async function seedDefaultBranch(overrides = {}) {
  const spec = { ...DEFAULT_BRANCH, ...overrides };
  const branch = await Branch.findOneAndUpdate(
    { code: spec.code },
    { $setOnInsert: { name: spec.name, isActive: spec.isActive } },
    { upsert: true, new: true }
  );
  return branch;
}

/** Backfill branchId on every document missing it. Returns per-collection counts. */
export async function backfillBranchId(branchId) {
  const counts = {};
  for (const { label, model } of TENANT_COLLECTIONS) {
    const result = await model.updateMany(
      { $or: [{ branchId: null }, { branchId: { $exists: false } }] },
      { $set: { branchId } }
    );
    counts[label] = result.modifiedCount;
  }
  return counts;
}

/**
 * Count documents that would violate a new compound unique constraint.
 * Returns { indexName: count } — any non-zero entry aborts the index swap.
 */
export async function findDuplicates(branchId) {
  const dupes = {};

  const countDupes = async (model, keys) => {
    const pipeline = [
      { $match: { branchId: new mongoose.Types.ObjectId(branchId) } },
      { $group: { _id: keys, n: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { n: { $gt: 1 } } },
    ];
    const rows = await model.aggregate(pipeline);
    return rows.reduce((acc, r) => acc + r.n, 0);
  };

  dupes.idx_members_branch_gender_gym_unique = await countDupes(Member, {
    branchId: "$branchId", gender: "$gender", gymId: "$gymId",
  });
  dupes.idx_members_branch_phone_unique = await countDupes(Member, {
    branchId: "$branchId", phone: "$phone",
  });
  dupes.idx_dailysummary_branch_date_unique = await countDupes(DailySummary, {
    branchId: "$branchId", date: "$date",
  });
  dupes.idx_kiosks_branch_kiosk_unique = await countDupes(Kiosk, {
    branchId: "$branchId", kioskId: "$kioskId",
  });

  return Object.fromEntries(Object.entries(dupes).filter(([, n]) => n > 0));
}

/**
 * Drop every index on `collection` whose KEY equals one of `supersededKeys`
 * (key-pattern equality, not name equality — names differ between the schema,
 * dbIndexes.js and seed.js declarations). Returns dropped index names.
 */
async function dropIndexesByPattern(collection, supersededKeys) {
  const existing = await collection.indexes();
  const dropped = [];
  for (const spec of supersededKeys) {
    const match = existing.find(
      (idx) => JSON.stringify(idx.key) === JSON.stringify(spec)
    );
    if (match && match.name !== "_id_") {
      await collection.dropIndex(match.name);
      dropped.push(match.name);
    }
  }
  return dropped;
}

/** Swap superseded indexes for the branch-scoped compounds. */
export async function swapIndexes() {
  const report = { dropped: [], created: [] };

  report.dropped.push(
    ...(await dropIndexesByPattern(Member.collection, [
      { gymId: 1, gender: 1 },
      { phone: 1 },
    ]))
  );
  report.dropped.push(
    ...(await dropIndexesByPattern(DailySummary.collection, [{ date: 1 }]))
  );
  report.dropped.push(
    ...(await dropIndexesByPattern(Kiosk.collection, [{ kioskId: 1 }]))
  );

  const memberBranchKeypad = { branchId: 1, gender: 1, gymId: 1 };
  const memberBranchPhone = { branchId: 1, phone: 1 };
  const summaryBranchDate = { branchId: 1, date: 1 };
  const kioskBranchKiosk = { branchId: 1, kioskId: 1 };

  await Member.collection.createIndex(memberBranchKeypad, {
    unique: true, name: "idx_members_branch_gender_gym_unique",
  });
  report.created.push("idx_members_branch_gender_gym_unique");
  await Member.collection.createIndex(memberBranchPhone, {
    unique: true, name: "idx_members_branch_phone_unique",
  });
  report.created.push("idx_members_branch_phone_unique");
  await DailySummary.collection.createIndex(summaryBranchDate, {
    unique: true, name: "idx_dailysummary_branch_date_unique",
  });
  report.created.push("idx_dailysummary_branch_date_unique");
  await Kiosk.collection.createIndex(kioskBranchKiosk, {
    unique: true, name: "idx_kiosks_branch_kiosk_unique",
  });
  report.created.push("idx_kiosks_branch_kiosk_unique");

  return report;
}

/**
 * Seed branch-scoped keypad counters from the branch's current max gymId.
 * Legacy global keys (gym_id_M / gym_id_F) are left untouched.
 */
export async function seedBranchCounters(branch) {
  const seeded = {};
  // Male runs its own M-series; Female + Transgender share the F-series
  // (same business rule as getNextGymId — there is no T-series).
  const series = [
    { prefix: "M", genders: ["Male"] },
    { prefix: "F", genders: ["Female", "Transgender"] },
  ];
  for (const { prefix, genders } of series) {
    const maxDoc = await Member.findOne({ branchId: branch._id, gender: { $in: genders } })
      .sort({ gymId: -1 })
      .select("gymId")
      .lean();
    const key = `gym_id_${branch.code}_${prefix}`;
    if (maxDoc?.gymId) {
      // Never lowers an existing counter (ensureMin uses $max).
      await Counter.ensureMin(key, maxDoc.gymId);
      seeded[key] = maxDoc.gymId;
    } else {
      // No members for this series yet — counter stays absent and seeds from
      // 0 on first allocation (same behavior as getNextGymId).
      seeded[key] = 0;
    }
  }
  return seeded;
}

/**
 * Full migration. Returns a report object; throws (before index changes) if
 * new unique constraints would be violated.
 */
export async function migrateAddBranches({ log = () => {} } = {}) {
  const report = {
    startedAt: new Date(),
    branch: null,
    backfilled: {},
    duplicates: {},
    indexes: { dropped: [], created: [] },
    counters: {},
    errors: [],
  };

  // ── 1. Default branch ────────────────────────────────────────────────
  const branch = await seedDefaultBranch();
  report.branch = { id: branch._id.toString(), name: branch.name, code: branch.code };
  log(`Branch: ${branch.name} (${branch.code}) -> ${branch._id}`);

  // ── 2. Backfill ──────────────────────────────────────────────────────
  report.backfilled = await backfillBranchId(branch._id);
  for (const [label, n] of Object.entries(report.backfilled)) {
    if (n > 0) log(`  backfilled ${label}: ${n}`);
  }

  // ── 3. Duplicate guard BEFORE any index change ───────────────────────
  report.duplicates = await findDuplicates(branch._id);
  if (Object.keys(report.duplicates).length > 0) {
    const detail = Object.entries(report.duplicates)
      .map(([k, n]) => `${k}=${n}`)
      .join(", ");
    throw new Error(
      `Refusing to create unique indexes: duplicate keys exist (${detail}). ` +
      `Resolve duplicates manually, then re-run.`
    );
  }

  // ── 4. Index swap ────────────────────────────────────────────────────
  report.indexes = await swapIndexes();
  log(`  dropped: ${report.indexes.dropped.join(", ") || "(none)"}`);
  log(`  created: ${report.indexes.created.join(", ")}`);

  // ── 5. Keypad counters ───────────────────────────────────────────────
  report.counters = await seedBranchCounters(branch);
  log(`  counters: ${JSON.stringify(report.counters)}`);

  report.completedAt = new Date();
  return report;
}

// ── CLI entry point ────────────────────────────────────────────────────
async function main() {
  if (process.env.MIGRATE_ADD_BRANCHES !== "1") {
    console.error(
      "ABORT: set MIGRATE_ADD_BRANCHES=1 to confirm this is an intentional operator action."
    );
    process.exit(1);
  }
  const uri = process.env.DATABASE_URL || process.env.MONGO_URI;
  if (!uri) {
    console.error("ABORT: DATABASE_URL/MONGO_URI is required.");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    console.log("Connected. Running multi-branch migration...\n");
    const report = await migrateAddBranches({ log: (m) => console.log(m) });
    console.log("\nMigration complete:");
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(`\nMIGRATION FAILED: ${err.message}`);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
