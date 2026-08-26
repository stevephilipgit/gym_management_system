// atomicCounter.js - Race-safe atomic counters for member codes
import mongoose from "mongoose";

const CounterSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      unique: true,
      required: true,
    },
    seq: {
      type: Number,
      default: 0,
      required: true,
    },
  },
  { timestamps: true }
);

CounterSchema.statics.increment = async function (key) {
  const doc = await this.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
};

// Ensure a counter never starts below a floor (used to seed per-gender gymId
// counters from the current max without lowering an existing value).
CounterSchema.statics.ensureMin = async function (key, min) {
  const doc = await this.findOneAndUpdate(
    { key, seq: { $lt: min } },
    { $set: { seq: min } },
    { new: true, upsert: true }
  );
  return doc.seq;
};

export default mongoose.model("Counter", CounterSchema);