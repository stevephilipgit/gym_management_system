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

export default mongoose.model("Counter", CounterSchema);