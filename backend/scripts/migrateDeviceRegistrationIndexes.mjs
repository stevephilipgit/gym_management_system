// scripts/migrateDeviceRegistrationIndexes.mjs — Operator-run index migration
//
// Fixes stale legacy indexes on `deviceregistrations` left by the old
// provisioning/request/claim architecture. The old non-partial unique index
// `idx_devicereg_act_uniq` blocks same-Trainer same-browser reactivation
// (E11000 → "Attendance device ownership conflict"); the legacy non-partial
// `idx_devicereg_keyfp_unique` would break a second revoke/reactivate cycle.
//
// SAFETY:
//   - Refuses to run unless MIGRATE_DEVICE_INDEXES=1 and the target database
//     is exactly "giri_gym" (production). Does NOT auto-run at startup.
//   - Prints current index state before any change.
//   - Aborts if the data violates the intended partial-unique constraints
//     (duplicate active trainer/kiosk, duplicate string fingerprints).
//   - Drops ONLY the known obsolete indexes; recreates keyFingerprint index
//     with the exact partial filter; verifies the final set.
//   - Does NOT modify any registration documents.
//
// Usage:
//   MIGRATE_DEVICE_INDEXES=1 DATABASE_URL="<prod mongo uri>" node scripts/migrateDeviceRegistrationIndexes.mjs

import mongoose from "mongoose";
import { execSync } from "node:child_process";

const PROD_DB_NAME = "giri_gym";
const COLLECTION = "deviceregistrations";

// Indexes the CURRENT code requires (see models/DeviceRegistration.js).
const REQUIRED_INDEXES = [
  { name: "idx_devicereg_trainer_active_unique", key: { trainerId: 1 }, unique: true, partial: { active: true } },
  { name: "idx_devicereg_kiosk_active_unique", key: { kioskId: 1 }, unique: true, partial: { active: true } },
  { name: "idx_devicereg_keyfp_unique", key: { kioskId: 1, keyFingerprint: 1 }, unique: true, partial: { keyFingerprint: { $type: "string" } } },
  { name: "idx_devicereg_trainer_created", key: { trainerId: 1, createdAt: -1 }, unique: false, partial: null },
];

// Legacy indexes to DROP (obsolete; no current code references them).
const LEGACY_INDEXES = [
  "idx_devicereg_act_uniq",                 // DIRECT BLOCKER (non-partial unique on kiosk/trainer/browser)
  "idx_devicereg_active_browser_unique",    // old partial unique (removed)
  "idx_devicereg_keyfp_unique",             // old non-partial version (will be recreated with partial filter)
  "idx_devicereg_live_workflow_unique",     // requestStatus partial (removed)
  "idx_devicereg_requests",                 // requestStatus query (removed)
  "idx_devicereg_trainer_requests",         // requestStatus query (removed)
  "idx_devicereg_kiosk_active",             // redundant compound (removed)
  "idx_devicereg_trainer_active",           // redundant compound (removed)
];

async function run() {
  if (process.env.MIGRATE_DEVICE_INDEXES !== "1") {
    console.error("ABORT: set MIGRATE_DEVICE_INDEXES=1 to confirm this is an intentional operator action.");
    process.exit(1);
  }
  const uri = process.env.DATABASE_URL || process.env.MONGO_URI;
  if (!uri) { console.error("ABORT: DATABASE_URL/MONGO_URI is required."); process.exit(1); }
  const dbName = (uri.match(/\/([a-zA-Z0-9_-]+)(\?|$)/) || [])[1];
  if (dbName !== PROD_DB_NAME) {
    console.error(`ABORT: expected production DB "${PROD_DB_NAME}", got "${dbName}". Refusing.`);
    process.exit(1);
  }

  const conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 5000 });
  await conn.asPromise();
  const db = conn.getClient().db(dbName);
  const coll = db.collection(COLLECTION);

  console.log(`\n=== DeviceRegistration index migration — target DB: ${dbName} ===\n`);

  // ── 1. Print current index state ────────────────────────────────────
  const idx = await coll.indexes();
  console.log("Current indexes:");
  idx.forEach(i => console.log(`  ${i.name} | ${JSON.stringify(i.key)} | unique=${!!i.unique} | partial=${JSON.stringify(i.partialFilterExpression || null)}`));

  // ── 2. Data-safety abort checks ─────────────────────────────────────
  const dupT = await coll.aggregate([{ $match: { active: true } }, { $group: { _id: "$trainerId", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
  if (dupT.length) { console.error("ABORT: duplicate ACTIVE trainerId — data violates INVARIANT A. Fix data first."); process.exit(1); }
  const dupK = await coll.aggregate([{ $match: { active: true } }, { $group: { _id: "$kioskId", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
  if (dupK.length) { console.error("ABORT: duplicate ACTIVE kioskId — data violates INVARIANT B. Fix data first."); process.exit(1); }
  const dupFp = await coll.aggregate([{ $match: { keyFingerprint: { $type: "string" } } }, { $group: { _id: "$keyFingerprint", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
  if (dupFp.length) { console.error("ABORT: duplicate string keyFingerprint — data violates INVARIANT C. Fix data first."); process.exit(1); }
  console.log("Data safety: OK (no active duplicate / fingerprint violations).\n");

  // ── 3. Drop ONLY the legacy indexes ─────────────────────────────────
  // NOTE: idx_devicereg_keyfp_unique is included in LEGACY_INDEXES so the
  // legacy non-partial variant is dropped here, then recreated below with the
  // correct partial filter (step 4). Do NOT add other names to this list.
  for (const name of LEGACY_INDEXES) {
    const exists = idx.find(i => i.name === name);
    if (exists) {
      console.log(`Dropping legacy index: ${name}`);
      await coll.dropIndex(name);
    } else {
      console.log(`Skipping (absent): ${name}`);
    }
  }

  // ── 4. Recreate keyFingerprint index with the correct partial filter ─
  // (the drop above removed the legacy non-partial one; create the current one)
  await coll.createIndex(
    { kioskId: 1, keyFingerprint: 1 },
    { unique: true, partialFilterExpression: { keyFingerprint: { $type: "string" } }, name: "idx_devicereg_keyfp_unique" }
  );
  console.log("Recreated idx_devicereg_keyfp_unique with partial filter.");

  // ── 5. Ensure the remaining current indexes exist (idempotent) ──────
  for (const spec of REQUIRED_INDEXES) {
    await coll.createIndex(spec.key, {
      ...(spec.unique ? { unique: true } : {}),
      ...(spec.partial ? { partialFilterExpression: spec.partial } : {}),
      name: spec.name,
    });
  }

  // ── 6. Verify final index set ───────────────────────────────────────
  const finalIdx = await coll.indexes();
  console.log("\nFinal indexes:");
  finalIdx.forEach(i => console.log(`  ${i.name} | ${JSON.stringify(i.key)} | unique=${!!i.unique} | partial=${JSON.stringify(i.partialFilterExpression || null)}`));
  const finalNames = new Set(finalIdx.map(i => i.name));
  const missing = REQUIRED_INDEXES.filter(r => !finalNames.has(r.name));
  const unexpected = finalIdx.map(i => i.name).filter(n => !["_id_", "registrationId_1", ...REQUIRED_INDEXES.map(r => r.name)].includes(n));
  if (missing.length) { console.error(`ABORT: missing required indexes: ${missing.map(m => m.name)}`); process.exit(1); }
  if (unexpected.length) { console.warn(`WARN: unexpected indexes remain: ${unexpected.join(", ")}`); }
  console.log("\nMigration complete. Verify reactivation + security flows, then remove the migration env var.");

  await conn.close();
}

run().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });