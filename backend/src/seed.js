import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Admin from "./models/Admin.js";
import Member from "./models/Member.js";
import Package from "./models/Package.js";
import PaymentLog from "./models/PaymentLog.js";
import FinanceLog from "./models/FinanceLog.js";
import DynamicField from "./models/DynamicField.js";

// ============================================================================
// MONGODB ATLAS CONNECTION
// ============================================================================
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI =
  process.env.MONGO_URI || process.env.DATABASE_URL || process.env.MONGO_URL;
const SEED_SUPERADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD;
const SEED_TRAINER_PASSWORD = process.env.SEED_TRAINER_PASSWORD;
const SEED_FINANCE_PASSWORD = process.env.SEED_FINANCE_PASSWORD;

if (!MONGO_URI) {
  console.error(
    "❌ ERROR: MONGO_URI, DATABASE_URL or MONGO_URL is not defined in environment variables."
  );
  process.exit(1);
}

if (!SEED_SUPERADMIN_PASSWORD || !SEED_TRAINER_PASSWORD || !SEED_FINANCE_PASSWORD) {
  console.error(
    "ERROR: SEED_SUPERADMIN_PASSWORD, SEED_TRAINER_PASSWORD and SEED_FINANCE_PASSWORD must be defined in environment variables."
  );
  process.exit(1);
}

// ============================================================================
// SEED FUNCTION
// ============================================================================
async function seedDatabase() {
  try {
    console.log("🔗 Connecting to MongoDB Atlas...");
    
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("✅ Connected to MongoDB Atlas successfully!");
    console.log(`📊 Database: ${mongoose.connection.name}`);

    // ========================================================================
    // 1. CREATE INDEXES FOR ALL COLLECTIONS
    // ========================================================================
    console.log("\n📋 Creating indexes...");

    await Admin.collection.createIndex({ username: 1 }, { unique: true });
    await Admin.collection.createIndex({ email: 1 }, { unique: true });
    console.log("  ✓ Admin indexes created");

    await Member.collection.createIndex({ gymId: 1 }, { unique: true });
    await Member.collection.createIndex({ aadhar: 1 }, { unique: true });
    console.log("  ✓ Member indexes created");

    await PaymentLog.collection.createIndex({ gymId: 1 });
    await PaymentLog.collection.createIndex({ paidAt: 1 });
    console.log("  ✓ PaymentLog indexes created");

    await FinanceLog.collection.createIndex({ gymId: 1 });
    await FinanceLog.collection.createIndex({ plan: 1 });
    await FinanceLog.collection.createIndex({ trainingType: 1 });
    await FinanceLog.collection.createIndex({ type: 1 });
    await FinanceLog.collection.createIndex({ date: 1 });
    console.log("  ✓ FinanceLog indexes created");

    await DynamicField.collection.createIndex({ key: 1 }, { unique: true });
    console.log("  ✓ DynamicField indexes created");

    // ========================================================================
    // 2. SEED ADMIN COLLECTION
    // ========================================================================
    console.log("\n👤 Resetting and seeding Admin collection...");

    const adminUsers = [
      {
        fullName: "Super Admin",
        username: "superadmin",
        email: "superadmin@gymproject.com",
        role: "superadmin",
        scope: "all",
        password: SEED_SUPERADMIN_PASSWORD,
      },
      {
        fullName: "Test Trainer",
        username: "testtrainer",
        email: "trainer@gymproject.com",
        role: "trainer",
        scope: "all",
        password: SEED_TRAINER_PASSWORD,
      },
      {
        fullName: "Test Finance",
        username: "testfinance",
        email: "finance@gymproject.com",
        role: "finance",
        scope: "all",
        password: SEED_FINANCE_PASSWORD,
      },
    ];

    // Delete every existing admin so the seeded credentials are always valid.
    const deleted = await Admin.deleteMany({});
    console.log(`  ✓ Deleted ${deleted.deletedCount} existing admin account(s)`);

    for (const user of adminUsers) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      const admin = new Admin({
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        role: user.role,
        scope: user.scope,
        passwordHash,
        lastLogin: null,
        resetOtp: null,
        otpExpiry: null,
      });
      await admin.save();
      console.log(`  ✓ Admin created (username: ${user.username}, email: ${user.email}, role: ${user.role})`);
    }
    console.log("  ℹ️  Three admin accounts created for testing (superadmin / trainer / finance).");

    // ========================================================================
    // 3. SEED PACKAGE COLLECTION
    // ========================================================================
    console.log("\n📦 Seeding Package collection...");

    const packageCount = await Package.countDocuments();

    if (packageCount === 0) {
      const packages = [
        {
          name: "1 Month",
          months: 1,
          priceWeightLoss: 2500,
          priceWeightGain: 2500,
          priceTransformation: 3000,
        },
        {
          name: "3 Months",
          months: 3,
          priceWeightLoss: 6500,
          priceWeightGain: 6500,
          priceTransformation: 8000,
        },
        {
          name: "6 Months",
          months: 6,
          priceWeightLoss: 11000,
          priceWeightGain: 11000,
          priceTransformation: 13000,
        },
        {
          name: "12 Months",
          months: 12,
          priceWeightLoss: 18000,
          priceWeightGain: 18000,
          priceTransformation: 22000,
        },
      ];

      await Package.insertMany(packages);
      console.log(`  ✓ ${packages.length} packages created`);
    } else {
      console.log(`  ℹ️  Package collection already has ${packageCount} records. Skipping...`);
    }

    // ========================================================================
    // 4. SEED DYNAMIC FIELD COLLECTION
    // ========================================================================
    console.log("\n🎯 Seeding DynamicField collection...");

    const dynamicFieldCount = await DynamicField.countDocuments();

    if (dynamicFieldCount === 0) {
      const dynamicFields = [
        {
          key: "emergency_contact",
          label: "Emergency Contact Name",
          type: "text",
          required: false,
          options: [],
        },
        {
          key: "emergency_phone",
          label: "Emergency Contact Phone",
          type: "text",
          required: false,
          options: [],
        },
        {
          key: "fitness_goal",
          label: "Fitness Goal",
          type: "dropdown",
          required: true,
          options: ["Weight Loss", "Muscle Gain", "Maintenance", "Flexibility"],
        },
        {
          key: "previous_injury",
          label: "Previous Injuries/Issues",
          type: "text",
          required: false,
          options: [],
        },
        {
          key: "diet_preference",
          label: "Diet Preference",
          type: "dropdown",
          required: false,
          options: ["Vegetarian", "Non-Vegetarian", "Vegan"],
        },
        {
          key: "referral_source",
          label: "How did you hear about us?",
          type: "dropdown",
          required: false,
          options: ["Friend", "Social Media", "Online Search", "Walk-in", "Other"],
        },
      ];

      await DynamicField.insertMany(dynamicFields);
      console.log(`  ✓ ${dynamicFields.length} dynamic fields created`);
    } else {
      console.log(`  ℹ️  DynamicField collection already has ${dynamicFieldCount} records. Skipping...`);
    }

    // ========================================================================
    // 5. DISPLAY SCHEMA SUMMARY
    // ========================================================================
    console.log("\n" + "=".repeat(70));
    console.log("📊 DATABASE SETUP COMPLETE!");
    console.log("=".repeat(70));
    console.log("\n✅ Collections Created:");
    console.log("  1. admins");
    console.log("  2. members");
    console.log("  3. packages");
    console.log("  4. paymentlogs");
    console.log("  5. financelogs");
    console.log("  6. dynamicfields");

    console.log("\n🔑 Sample Data Added:");
    console.log("  ✓ 3 Admin users (superadmin, trainer, finance)");
    console.log("  ✓ 4 Package plans (1M, 3M, 6M, 12M)");
    console.log("  ✓ 6 Dynamic fields for member registration");

    console.log("\n📝 Next Steps:");
    console.log("  1. Update Admin passwordHash using BCrypt");
    console.log("  2. Run your backend server: npm start");
    console.log("  3. Start registering members!");

    console.log("\n" + "=".repeat(70));

    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding Error:", error.message);
    console.error("\nTroubleshooting:");
    console.error("  • Check if connection string is correct");
    console.error("  • Verify username and password");
    console.error("  • Ensure IP address is whitelisted in MongoDB Atlas");
    console.error("  • Check network connectivity");
    process.exit(1);
  }
}

// ============================================================================
// RUN SEEDING
// ============================================================================
console.log("🌱 GYM PROJECT - DATABASE SEEDING SCRIPT");
console.log("=".repeat(70));
seedDatabase();
