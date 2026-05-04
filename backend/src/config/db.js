import mongoose from "mongoose";
import config from "./index.js";

const connectDB = async () => {
  try {
    await mongoose.connect(config.db.url);
    console.log("✅ MongoDB Connected Successfully!");
  } catch (err) {
    console.error("❌ MongoDB Connection Failed:", err.message);
    process.exit(1);
  }
};

export default connectDB;
