// scripts/reset-gym-counters.mjs
// One-time reset of the per-gender gymId counters so NEW registrations start
// at 1 for each gender:
//   Male              -> 1, 2, 3...
//   Female            -> 1, 2, 3...
//   Transgender       -> shares the female series (same gym) -> 1, 2, 3...
//
// Legacy members are expected to be deleted separately. This script only
// resets the counters; it does NOT touch member documents.
//
// Run: cd backend && node scripts/reset-gym-counters.mjs

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.DATABASE_URL || process.env.MONGO_URI || process.env.MONGO_URL;
if (!uri) {
  console.error("No DATABASE_URL/MONGO_URI/MONGO_URL found.");
  process.exit(1);
}

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const Counters = mongoose.connection.collection("counters");

  // Only the gym-id counters. member_code_* counters are intentionally left
  // untouched (they already start at 0001 and are a separate identifier).
  const res = await Counters.deleteMany({ key: { $in: ["gym_id_M", "gym_id_F"] } });
  console.log(`Reset ${res.deletedCount} gym-id counter(s).`);
  console.log("Next male -> 1; next female/transgender -> 1.");

  await mongoose.disconnect();
  console.log("Done.");
} catch (err) {
  console.error("Reset failed:", err.message);
  process.exit(1);
}
