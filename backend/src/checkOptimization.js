import dotenv from "dotenv";
import mongoose from "mongoose";
import DailySummary from "./models/DailySummary.js";

dotenv.config();

async function checkOptimization() {
  try {
    await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/giri_gym");
    console.log("✅ MongoDB connected");

    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log("\n📚 Collections in database:", collections.map(c => c.name).join(", "));

    const summary = await DailySummary.findOne({});
    console.log("\n📊 DailySummary collection:");
    if (summary) {
      console.log("   ✅ Collection exists");
      console.log("   Latest document:");
      console.log(`     Date: ${summary.date.toISOString().split('T')[0]}`);
      console.log(`     Total Revenue: ₹${summary.totalRevenue}`);
      console.log(`     Transactions: ${summary.totalTransactions}`);
      console.log(`     New Joining: ₹${summary.newJoiningRevenue}`);
      console.log(`     Renewals: ₹${summary.renewalRevenue}`);
    } else {
      console.log("   ℹ️  No summaries yet (will be created on first transaction)");
    }

    const modelSchema = DailySummary.schema;
    console.log("\n🔧 DailySummary schema indexes:");
    const indexes = modelSchema.getIndexes();
    Object.entries(indexes).forEach(([key, spec]) => {
      console.log(`   - ${JSON.stringify(key)}`);
    });

    console.log("\n✅ Optimization verification complete!");
    console.log("\nNext: Register a new member in the admin panel to see the summary update in real-time.");

    await mongoose.disconnect();
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

checkOptimization();
