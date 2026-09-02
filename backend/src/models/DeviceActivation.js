import mongoose from "mongoose";

const deviceActivationSchema = new mongoose.Schema(
  {
    activationId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    trainerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    // Authoritative scope frozen at generation time (derived from the Trainer
    // record, never from the client). At redemption the physical device must
    // match this scope or the activation is rejected.
    scope: {
      type: String,
      enum: ["male", "female_plus_transgender"],
      required: true,
    },
    // bcrypt hashes only. Plaintext code/secret exist only transiently during
    // generation/display and are never persisted or logged.
    codeHash: {
      type: String,
      required: true,
    },
    secretHash: {
      type: String,
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    usedByBrowserDeviceId: {
      type: String,
      default: null,
    },
    // "code" | "qr" | null — which redemption method consumed this activation.
    usedByMethod: {
      type: String,
      enum: ["code", "qr", null],
      default: null,
    },
  },
  { timestamps: true }
);

// Redemption lookup: by trainer, unexpired, not used/revoked.
deviceActivationSchema.index(
  { trainerId: 1, expiresAt: 1, usedAt: 1, revokedAt: 1 },
  { name: "idx_device_activation_lookup" }
);

// Logical-expiry sweep (no TTL delete — audit records survive).
deviceActivationSchema.index({ expiresAt: 1 }, { name: "idx_device_activation_expiry" });

export default mongoose.model("DeviceActivation", deviceActivationSchema);
