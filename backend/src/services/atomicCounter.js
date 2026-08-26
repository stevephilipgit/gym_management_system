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
  try {
    const doc = await this.findOneAndUpdate(
      { key },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    return doc.seq;
  } catch (err) {
    // Concurrent first-time upsert race: another request inserted the counter
    // first. Retry the increment against the now-existing document.
    if (err && err.code === 11000) {
      const doc = await this.findOneAndUpdate(
        { key },
        { $inc: { seq: 1 } },
        { new: true }
      );
      return doc.seq;
    }
    throw err;
  }
};

// Ensure a counter never starts below a floor (used to seed per-gender gymId
// counters from the current max without lowering an existing value).
// Uses $max with an equality filter: NEVER attempts an upsert insert when the
// counter already exists (a range filter + upsert would collide on `key`).
CounterSchema.statics.ensureMin = async function (key, min) {
  const doc = await this.findOneAndUpdate(
    { key },
    { $max: { seq: min } },
    { new: true, upsert: true }
  );
  return doc.seq;
};

export default mongoose.model("Counter", CounterSchema);