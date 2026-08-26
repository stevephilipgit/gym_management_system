// scripts/preflight-member-identity.mjs
// READ-ONLY database preflight for the member-identity change.
// Makes NO writes.
//
// Run: cd backend && node scripts/preflight-member-identity.mjs

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.DATABASE_URL || process.env.MONGO_URI || process.env.MONGO_URL;

if (!uri) {
  console.error("No DATABASE_URL/MONGO_URI found.");
  process.exit(1);
}

try {
  const u = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "mongodb://"));
  console.log(`Connecting to ${u.hostname}:${u.port || 27017}, db=${u.pathname.replace(/^\//, "")}`);
} catch {
  console.log("Connecting (URI host not parsed).");
}

let Members;
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  Members = mongoose.connection.collection("members");
} catch (err) {
  console.error("CONNECT FAILED:", err.message);
  process.exit(1);
}

const report = async (label, fn) => {
  try {
    const value = await fn();
    console.log(`${label}:`, JSON.stringify(value));
  } catch (err) {
    console.log(`${label}: ERROR — ${err.message}`);
  }
};

await report("Total members", () => Members.countDocuments({}));

await report("Gender counts", () =>
  Members.aggregate([{ $group: { _id: "$gender", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray()
);

await report("Missing/empty memberCode", () =>
  Members.countDocuments({ $or: [{ memberCode: { $exists: false } }, { memberCode: null }, { memberCode: "" }] })
);

await report("Null/empty/invalid gender", () =>
  Members.countDocuments({ $or: [{ gender: null }, { gender: "" }, { gender: { $exists: false } }] })
);

await report("Duplicate memberCodes", () =>
  Members.aggregate([
    { $match: { memberCode: { $exists: true, $nin: [null, ""] } } },
    { $group: { _id: "$memberCode", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: "dupes" },
  ]).toArray()
);

await report("Duplicate (gymId, gender) pairs", () =>
  Members.aggregate([
    { $group: { _id: { gymId: "$gymId", gender: "$gender" }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: "dupes" },
  ]).toArray()
);

await report("Duplicate gymId across genders", () =>
  Members.aggregate([
    { $group: { _id: "$gymId", genders: { $addToSet: "$gender" }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: "dupes" },
  ]).toArray()
);

await mongoose.disconnect();
console.log("\nPreflight complete (read-only).");
process.exit(0);
