// models/Member.js
import mongoose from "mongoose";
import { generateFormattedName } from "../utils/nameFormatter.js";

const memberSchema = new mongoose.Schema(
  {
    gymId: { type: Number, required: true },

    fullName: { type: String, required: true },
    fatherName: { type: String, required: true },

    dob: { type: Date, required: true },
    bloodGroup: { type: String, required: true },

    gender: {
      type: String,
      enum: ["Male", "Female", "Transgender"],
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

    // ✅ Feature 4: Member Code - canonical gender-prefixed system identifier
    // (M0001 / F0001 / T0001). Globally unique by construction (per-gender
    // atomic counters with disjoint prefixes). Sparse unique index guards
    // against accidental duplicates; legacy rows are backfilled by migration.
    memberCode: {
      type: String,
      unique: true,
      sparse: true,
    },
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

    // Optimistic concurrency: incremented on every update/renew. Clients must
    // send the version they loaded; a mismatch means another admin edited the
    // member and the write is rejected with 409 (never silently overwrite).
    version: {
      type: Number,
      default: 0,
      min: 0,
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

// Legacy documents created before the version field hydrate without it;
// normalize to 0 so the API always returns a concrete version for concurrency.
memberSchema.post("init", function () {
  if (typeof this.version !== "number") {
    this.version = 0;
  }
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

// Primary member-list query: gender-scoped, sorted by most recent.
// Without this compound index, MongoDB sorts by createdAt then filters by
// gender in memory (or vice versa) — slow at scale.
memberSchema.index({ gender: 1, createdAt: -1 });

// Identity: a numeric gymId is only unique WITHIN a gender (male gym "101"
// and female gym "101" are distinct members). The global gymId unique index
// was removed — the compound unique below is the correct uniqueness boundary.
// NOTE: the old global index must be dropped by scripts/migrate-member-identity.js.
memberSchema.index({ gymId: 1, gender: 1 }, { unique: true });

export default mongoose.model("Member", memberSchema);
