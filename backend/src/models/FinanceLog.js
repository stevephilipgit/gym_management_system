// models/FinanceLog.js
import mongoose from "mongoose";

const financeLogSchema = new mongoose.Schema(
  {
    gymId: {
      type: Number,
      required: true,
      index: true, // fast gym-wise queries (future use)
    },

    memberName: {
      type: String,
      required: true,
      trim: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // IMPORTANT: store ONLY normalized plan labels
    // Examples:
    // "1 Month", "3 Months", "6 Months", "12 Months"
    plan: {
      type: String,
      required: true,
      enum: ["1 Month", "3 Months", "6 Months", "12 Months"],
      index: true,
    },

    // IMPORTANT: consistent naming with space
    // Frontend + Backend + Charts rely on this
    trainingType: {
      type: String,
      required: true,
      enum: ["Weight Loss", "Weight Gain", "Transformation"],
      index: true,
    },

    // New joining or renewal
    type: {
      type: String,
      enum: ["new", "renew"],
      required: true,
      index: true,
    },

    // Payment date (used for reports)
    date: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true, // createdAt / updatedAt (optional but useful)
  }
);

export default mongoose.model("FinanceLog", financeLogSchema);
