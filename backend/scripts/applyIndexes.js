import dotenv from "dotenv";
import mongoose from "mongoose";
import { collectionIndexes } from "../src/utils/dbIndexes.js";

dotenv.config();

const applyIndexes = async () => {
  await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/giri_gym");
  console.log("[Indexes] Connected to MongoDB");
  const db = mongoose.connection.db;

  for (const definition of collectionIndexes) {
    const collection = db.collection(definition.collection);
    for (const index of definition.indexes) {
      await collection.createIndex(index.key, index.options);
      console.log(`[Indexes] ${definition.collection}.${index.options.name} - done`);
    }
  }

  console.log("[Indexes] All indexes applied successfully");
  await mongoose.disconnect();
};

applyIndexes().catch((err) => {
  console.error("[Indexes] Failed:", err.message);
  process.exit(1);
});
