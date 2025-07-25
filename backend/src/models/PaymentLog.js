// models/PaymentLog.js
import mongoose from "mongoose";

const paymentLogSchema = new mongoose.Schema(
  {
    gymId: { type: Number, required: true },
    name: { type: String, required: true },

    // example: "1 Month", "3 Months", "6 Months", "1 Year"
    plan: { type: String, required: true },

    // Weight Loss / Weight Gain / Transformation
    trainingType: { type: String, required: true },

    amount: { type: Number, required: true },

    // "new" or "renewal"
    type: { type: String, enum: ["new", "renewal"], required: true },

    paymentMode: { type: String, enum: ["cash", "gpay", "card"], required: true },

    paidAt: { type: Date, default: Date.now }, // exact time

    // ✅ Feature 2: Diet Management
    dietId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Diet",
      default: null,
    },
    dietName: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("PaymentLog", paymentLogSchema);
