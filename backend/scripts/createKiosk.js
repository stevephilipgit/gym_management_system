// scripts/createKiosk.js - Provision a physical attendance device
//
// Usage:
//   node scripts/createKiosk.js <kioskId> <scope> [name]
//
//   kioskId  — stable identifier, e.g. "male-tablet-01"
//   scope    — "male" or "female_plus_transgender"
//   name     — optional human-readable label
//
// The physical Kiosk is created WITHOUT a credential. Authentication is
// handled by DeviceRegistration (browser instances bound to this Kiosk via
// the trainer activation flow). After creating the Kiosk, a trainer must
// log into the Trainer Portal and activate this device to make the customer
// attendance page work.
//
// Requires MONGO_URI / DATABASE_URL in the environment.

import mongoose from "mongoose";
import Kiosk from "../src/models/Kiosk.js";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.DATABASE_URL;

if (!MONGO_URI) {
  console.error("❌ ERROR: MONGO_URI or DATABASE_URL is not defined in environment variables.");
  process.exit(1);
}

const VALID_SCOPES = ["male", "female_plus_transgender"];

const [kioskId, scope, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ");

if (!kioskId || !/^[a-zA-Z0-9_-]+$/.test(kioskId)) {
  console.error("❌ ERROR: kioskId is required (letters, numbers, - and _ only).");
  process.exit(1);
}

if (!scope || !VALID_SCOPES.includes(scope)) {
  console.error(`❌ ERROR: scope must be one of: ${VALID_SCOPES.join(", ")}`);
  process.exit(1);
}

async function createKiosk() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    const existing = await Kiosk.findOne({ kioskId });
    if (existing) {
      console.error(`❌ ERROR: A kiosk with kioskId "${kioskId}" already exists.`);
      process.exit(1);
    }

    const kiosk = await Kiosk.create({
      kioskId,
      name,
      scope,
      enabled: true,
    });

    console.log("=".repeat(70));
    console.log("✅ PHYSICAL DEVICE CREATED SUCCESSFULLY!");
    console.log("=".repeat(70));
    console.log(`\n  Kiosk ID : ${kiosk.kioskId}`);
    console.log(`  Name     : ${name || "(none)"}`);
    console.log(`  Scope    : ${kiosk.scope}`);
    console.log(`  Enabled  : ${kiosk.enabled}\n`);
    console.log("  NEXT STEP: Have a trainer log into the Trainer Portal,");
    console.log("  go to Attendance Devices, and activate this device.\n");
    console.log("  The device credential is issued automatically on activation.");
    console.log("  No manual API key entry is needed.\n");
    console.log("=".repeat(70) + "\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

createKiosk();