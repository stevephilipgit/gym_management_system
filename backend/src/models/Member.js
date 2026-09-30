// models/Member.js
import mongoose from "mongoose";
import { generateFormattedName } from "../utils/nameFormatter.js";
import { resolvePhotoUrl } from "../media/delivery.js";

const memberSchema = new mongoose.Schema(
  {
    // Multi-tenancy root: every member belongs to exactly one branch.
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },

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

    // Legacy local-disk reference (`/uploads/...`). Kept for documents created
    // before the media pipeline and for the rollback path when the media
    // pipeline is disabled. Never used when `photoKey` is set.
    photoUrl: String,

    // Active photo object in the private bucket — a versioned, immutable key
    // (see media/objectKeys.js). The object itself is never stored here.
    photoKey: { type: String, default: null },

    // Objects replaced by a newer photo, kept for the retention window
    // (MEDIA_PREVIOUS_RETENTION_DAYS, default 14) so devices that have not yet
    // fetched the new member state keep rendering. Pruned by the media cleanup
    // job — never deleted at write time.
    previousPhotos: {
      type: [{ key: String, retiredAt: Date }],
      default: [],
    },

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

    // Idempotency key: the frontend-sent clientRequestId ensures that a
    // duplicate submission (network retry, double-click) never creates two
    // members. A sparse unique index enforces the constraint.
    clientRequestId: {
      type: String,
      unique: true,
      sparse: true,
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

// Serialization: clients keep rendering `member.photoUrl`, but its VALUE is
// resolved here once — an active `photoKey` maps to the private-bucket delivery
// URL, otherwise the legacy `/uploads/...` reference is returned untouched.
// Queries that end in `.lean()` bypass this transform, so those call sites
// resolve explicitly (see utils/attendanceInput.js, controllers/attendanceController.js).
const resolvePhotoOnSerialize = (doc, ret) => {
  if (ret) ret.photoUrl = resolvePhotoUrl(ret);
  return ret;
};

memberSchema.set("toJSON", { transform: resolvePhotoOnSerialize });
memberSchema.set("toObject", { transform: resolvePhotoOnSerialize });

// ✅ ANALYTICS OPTIMIZATION INDEXES
memberSchema.index({ dob: 1 });
memberSchema.index({ gymPlan: 1 });
memberSchema.index({ createdAt: 1 });
memberSchema.index({ status: 1 });
memberSchema.index({ dob: 1, createdAt: 1 });
memberSchema.index({ gymPlan: 1, createdAt: 1 });

// ✅ Feature 3: Membership check by phone. Unique PER BRANCH — the same
// phone may legitimately exist in two branches; public/kiosk phone lookups
// handle the cross-branch ambiguity (see memberController.checkPublicValidity).
memberSchema.index({ branchId: 1, phone: 1 }, { unique: true, name: "idx_members_branch_phone_unique" });
memberSchema.index({ phone: 1, validityEnd: 1 });

// Primary member-list query: branch- and gender-scoped, sorted by most recent.
// Without this compound index, MongoDB sorts by createdAt then filters by
// gender in memory (or vice versa) — slow at scale.
memberSchema.index({ branchId: 1, gender: 1, createdAt: -1 });

// Identity: a numeric gymId (the keypad/serial number printed on bills and
// kiosks) is unique within (branch, gender). Male gym "101" and female gym
// "101" in the SAME branch are distinct, and the same number may recur in a
// different branch. This compound unique is the correctness boundary.
memberSchema.index(
  { branchId: 1, gender: 1, gymId: 1 },
  { unique: true, name: "idx_members_branch_gender_gym_unique" }
);

export default mongoose.model("Member", memberSchema);
