// models/Member.js
import mongoose from "mongoose";
import { generateFormattedName } from "../utils/nameFormatter.js";

const memberSchema = new mongoose.Schema(
  {
    gymId: { type: Number, unique: true, required: true },

    fullName: { type: String, required: true },
    fatherName: { type: String, required: true },

    dob: { type: Date, required: true },
    bloodGroup: { type: String, required: true },

    gender: {
      type: String,
      enum: ["Male", "Female"],
      required: true,
    },

    medicalIssues: { type: String, default: "None" },
    address: { type: String, required: true },

    aadhar: {
      type: String,
      required: true,
      unique: true,
      set: (v) => String(v).replace(/\D/g, ""),
      validate: {
        validator: (v) => String(v).length === 12,
        message: "Aadhar must be 12 digits",
      },
    },

    occupation: { type: String, required: true },

    phone: {
      type: String,
      required: true,
      validate: {
        validator: (v) => /^[6-9]\d{9}$/.test(v),
        message: "Phone must start with 6-9 and be 10 digits",
      },
    },

    photoUrl: String,

    gymPlan: { type: String, required: true },
    trainingType: { type: String, required: true },

    paymentStatus: {
      type: String,
      enum: ["paid", "not_paid"],
      default: "not_paid",
    },

    paymentMode: {
      type: String,
      enum: ["cash", "gpay", "card"],
      default: null,
    },

    currentPaymentDate: Date,
    oldPaymentDate: Date,
    validityEnd: Date,

    status: {
      type: String,
      enum: ["active", "expired", "draft"],
      default: "draft",
    },

    /* ✅ FIXED: Object instead of Map */
    customFields: {
      type: Object,
      default: {},
    },

    // ✅ Feature 2: Diet Management
    dietId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Diet",
      default: null,
    },
    dietIncludedInLastBilling: {
      type: Boolean,
      default: false,
    },

    // ✅ Attendance tracking: Last valid check-in date
    lastAttendanceDate: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

memberSchema.pre("save", function (next) {
  if (this.fullName && this.fatherName) {
    this.fullName = generateFormattedName(this.fullName, this.fatherName);
  }
  next();
});

// ✅ ANALYTICS OPTIMIZATION INDEXES
memberSchema.index({ dob: 1 });
memberSchema.index({ gymPlan: 1 });
memberSchema.index({ createdAt: 1 });
memberSchema.index({ status: 1 });
memberSchema.index({ dob: 1, createdAt: 1 });
memberSchema.index({ gymPlan: 1, createdAt: 1 });

// ✅ Feature 3: Membership check by phone (UNIQUE for Feature 4)
memberSchema.index({ phone: 1 }, { unique: true });
memberSchema.index({ phone: 1, validityEnd: 1 });

export default mongoose.model("Member", memberSchema);
