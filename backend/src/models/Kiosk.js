// models/Kiosk.js - Physical gym-owned attendance device
//
// A Kiosk represents a PHYSICAL attendance terminal (a tablet/PC mounted in the
// gym). It has a FIXED server-controlled physical scope:
//   - "male"                   → Male customer population
//   - "female_plus_transgender" → Female + Transgender population
//
// The Kiosk is NOT a trainer and NOT a customer. Its identity is the kioskId;
// its credential does NOT live here. Each browser/device instance that is
// authorized to act as this terminal holds a credential in a
// DeviceRegistration bound to this Kiosk (see models/DeviceRegistration.js).
//
// The pre-Phase-2 `apiKeyHash` credential field was removed in Phase 6C-B and
// is absent from the schema. kioskAuth reads DeviceRegistration.apiKeyHash
// exclusively — there is no Kiosk-level credential.

import mongoose from "mongoose";

const kioskSchema = new mongoose.Schema(
  {
    // Stable identifier, e.g. "male-tablet-01". Sent as X-Kiosk-Id.
    kioskId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^[a-zA-Z0-9_-]+$/, "kioskId may only contain letters, numbers, - and _"],
    },

    // Human-readable label, e.g. "Male Gym Tablet 01".
    name: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },

    // FIXED physical scope. Set by Super Admin at creation; changed only via an
    // explicit reassignment operation (which invalidates all registrations).
    scope: {
      type: String,
      enum: ["male", "female_plus_transgender"],
      required: true,
    },

    // Set on every scope reassignment. kioskAuth rejects any registration whose
    // activatedAt predates this timestamp (defense-in-depth against a missed
    // invalidation).
    scopeChangedAt: {
      type: Date,
      default: null,
    },

    // Fail-closed switch: a disabled device rejects every request even with a
    // valid registration credential.
    enabled: {
      type: Boolean,
      default: true,
    },

    // Number of ACTIVE DeviceRegistrations currently bound to this device.
    // The atomic cap (Database Invariant Gate #3) is enforced against this
    // counter via findOneAndUpdate({ $lt: MAX }, { $inc: 1 }) inside the
    // claim transaction — never "count → insert".
    activeRegistrationCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastUsedAt: {
      type: Date,
      default: null,
    },

    // Audit metadata only — NEVER an authorization boundary.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true }
);

// kioskId unique index is created by the schema field `unique: true`.
kioskSchema.index({ scope: 1, enabled: 1 }, { name: "idx_kiosks_scope_enabled" });

export default mongoose.model("Kiosk", kioskSchema);