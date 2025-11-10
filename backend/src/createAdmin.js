import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Admin from "./models/Admin.js";

const MONGO_URI = "mongodb+srv://<db_user>:<db_password>@cluster.mongodb.net/gym_db";

async function createAdmin() {
  try {
    console.log("🔗 Connecting to MongoDB Atlas...");
    
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("✅ Connected to MongoDB Atlas!\n");

    // ========================================================================
    // NEW ADMIN CREDENTIALS
    // ========================================================================
    const newAdmin = {
      fullName: "Steve Admin",
      username: "steveadmin2026",
      email: "steveadmin2026@gymproject.com",
      role: "superadmin",
      password: "Steve@2026Admin", // Plain password
    };

    // Hash password
    console.log("🔐 Hashing password...");
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newAdmin.password, salt);

    console.log("📝 Creating new admin account...\n");

    // Create admin
    const admin = new Admin({
      fullName: newAdmin.fullName,
      username: newAdmin.username,
      email: newAdmin.email,
      role: newAdmin.role,
      passwordHash: passwordHash,
      lastLogin: null,
      resetOtp: null,
      otpExpiry: null,
    });

    await admin.save();

    console.log("=" * 70);
    console.log("✅ NEW ADMIN ACCOUNT CREATED SUCCESSFULLY!");
    console.log("=" * 70);
    console.log("\n📋 Login Credentials:\n");
    console.log(`  Username: ${newAdmin.username}`);
    console.log(`  Email:    ${newAdmin.email}`);
    console.log(`  Password: ${newAdmin.password}`);
    console.log(`  Role:     ${newAdmin.role}\n`);
    console.log("=" * 70);
    console.log("✅ Ready to login!");
    console.log("=" * 70 + "\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

createAdmin();
