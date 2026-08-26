// scripts/migrate-member-identity.mjs
// Coordinated migration for the member-identity architecture change.
//
// Changes:
//  1. Backfill missing memberCode from per-gender atomic counters.
//  2. Seed per-gender gym_id counters from the current max for each gender.
//  3. Drop the old globally-unique `gymId_1` index (compound gymId+gender
//     replaces it — new code already queries within scope).
//  4. Create the compound + memberCode indexes (safe — preflight confirmed
//     no duplicates).
//
// Idempotent: each step is safe to re-run.
//
// Run: cd backend && node scripts/migrate-member-identity.mjs

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.DATABASE_URL || process.env.MONGO_URI || process.env.MONGO_URL;
if (!uri) {
  console.error("No DATABASE_URL/MONGO_URI found.");
  process.exit(1);
}

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db;
  const Members = db.collection("members");
  const Counters = db.collection("counters");

  console.log("=== MEMBER IDENTITY MIGRATION ===");

  // ── 1. Backfill missing memberCode ──────────────────────────────────────
  const missing = await Members.countDocuments({ $or: [{ memberCode: { $exists: false } }, { memberCode: null }, { memberCode: "" }] });
  if (missing > 0) {
    console.log(`Backfilling ${missing} missing memberCodes...`);
    const genders = ["Male", "Female", "Transgender"];
    let backfilled = 0;
    for (const gender of genders) {
      const prefix = { Male: "M", Female: "F", Transgender: "T" }[gender];
      const cursor = Members.find({
        gender,
        $or: [{ memberCode: { $exists: false } }, { memberCode: null }, { memberCode: "" }],
      });
      for await (const doc of cursor) {
        const counter = await Counters.findOneAndUpdate(
          { key: `member_code_${prefix}` },
          { $inc: { seq: 1 } },
          { upsert: true, returnDocument: "after" }
        );
        const memberCode = `${prefix}${String(counter.seq).padStart(4, "0").slice(-4)}`;
        await Members.updateOne({ _id: doc._id }, { $set: { memberCode } });
        backfilled++;
      }
    }
    console.log(`  Backfilled ${backfilled} memberCodes.`);
  } else {
    console.log("No missing memberCodes (nothing to backfill).");
  }

  // ── 2. Seed per-gender gym_id counters ──────────────────────────────────
  const genders = ["Male", "Female", "Transgender"];
  for (const gender of genders) {
    const prefix = { Male: "M", Female: "F", Transgender: "T" }[gender];
    const key = `gym_id_${prefix}`;
    const maxRows = await Members.find({ gender }).sort({ gymId: -1 }).limit(1).toArray();
    const floor = Math.max(1000, maxRows[0]?.gymId || 1000);
    await Counters.findOneAndUpdate(
      { key, seq: { $lt: floor } },
      { $set: { seq: floor } },
      { upsert: true }
    );
    const existing = await Counters.findOne({ key });
    console.log(`  Counter ${key}: ${existing?.seq || "?"}`);
  }

  // ── 3. Drop the old global gymId unique index (any name) ────────────────
  const currentIndexes = await Members.indexes();
  for (const idx of currentIndexes) {
    const keys = Object.keys(idx.key);
    // The old global unique has exactly { gymId: 1 } (no gender component).
    if (keys.length === 1 && keys[0] === "gymId") {
      try {
        await Members.dropIndex(idx.name);
        console.log(`Dropped old global gymId unique index (${idx.name}).`);
      } catch (err) {
        console.error(`Failed to drop ${idx.name}:`, err.message);
      }
    }
  }

  // ── 4. Create compound + memberCode indexes ─────────────────────────────
  try {
    await Members.createIndex({ gymId: 1, gender: 1 }, { unique: true, name: "idx_members_gym_gender_unique" });
    console.log("Created compound unique (gymId+gender).");
  } catch (err) {
    if (err.code === 85) console.log("Compound index already exists.");
    else console.error("Failed to create compound index:", err.message);
  }
  try {
    await Members.createIndex({ memberCode: 1 }, { unique: true, sparse: true, name: "idx_members_memberCode_unique" });
    console.log("Created memberCode unique (sparse).");
  } catch (err) {
    if (err.code === 85) console.log("memberCode index already exists.");
    else console.error("Failed to create memberCode index:", err.message);
  }

  console.log("Migration complete.");
} catch (err) {
  console.error("MIGRATION FAILED:", err.message);
  process.exit(1);
} finally {
  await mongoose.disconnect();
  process.exit(0);
}