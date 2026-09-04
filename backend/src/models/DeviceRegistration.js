// models/DeviceRegistration.js - Browser/device registration bound to a physical
// attendance context (a Kiosk). The attendance credential lives here and is the
// authority for customer punches via kioskAuth.
//
// INVARIANTS (enforced by DB partial unique indexes, not just app logic):
//   A. { trainerId: 1 } unique where active:true
//      → at most ONE active attendance device per Trainer.
//   B. { kioskId: 1 } unique where active:true
//      → at most ONE active Trainer owner per browserDeviceId/Kiosk.
//      A second Trainer cannot silently take over a browser owned by another.
//   C. { kioskId: 1, keyFingerprint: 1 } unique where keyFingerprint is a string
//      → O(1) credential lookup for kioskAuth (exactly one bcrypt compare).
//
// Lifecycle:
//   active=true, locked=false → active registration carrying a live credential.
//   active=true, locked=true  → locked; credentials preserved; no attendance.
//   Trainer deactivation → active=false, deactivatedAt set, deactivationReason="trainer";
//       credential preserved for secure reactivation (new key issued at reactivate).
//   Replacement → active=false, deactivatedAt set, deactivationReason="replaced";
//       credential destroyed; terminal.
//   Revoke (Super Admin) → active=false, revokedAt set, deactivationReason="revoked";
//       credential destroyed; terminal.
//   Scope reassign → active=false, revokedAt set, deactivationReason="scope_reassigned";
//       credential destroyed; terminal.

import mongoose from "mongoose";

const deviceRegistrationSchema = new mongoose.Schema(
  {
    registrationId: { type: String, required: true, unique: true },

    // Physical attendance context identity. In the simplified architecture this
    // equals the browserDeviceId of the redeeming browser (auto-created Kiosk).
    kioskId: { type: String, ref: "Kiosk", required: true },

    // The Trainer who owns this registration.
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },

    // Stable browser identity (generated once per browser, persisted in
    // localStorage). It is an IDENTIFIER only — NOT hardware attestation.
    browserDeviceId: { type: String, required: true },

         // ── Registration lifecycle ─────────────────────────────────────────
    active: { type: Boolean, default: true },
    activatedAt: { type: Date, default: Date.now },
    deactivatedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },

    // Distinguishes Trainer-initiated deactivation (reactivable) from
    // replacement / revocation / scope-change (terminal).
    //   "trainer"           → deactivationRegistration(); reactivatable by Trainer
    //   "replaced"          → replacement during redeemActivation(); terminal
    //   "revoked"           → revokeRegistration() (Super Admin); terminal
    //   "scope_reassigned"  → reassignKioskScope() (Super Admin); terminal
    deactivationReason: {
      type: String,
      enum: ["trainer", "replaced", "revoked", "scope_reassigned"],
      default: null,
    },
    reactivatedAt: { type: Date, default: null },

    // ── Lock state (temporary attendance pause) ───────────────────────
    // locked=true requires active=true. Credentials are preserved so the
    // Trainer can unlock and resume without Super Admin involvement.
    locked: { type: Boolean, default: false, index: true },
    lockedAt: { type: Date, default: null },
    unlockedAt: { type: Date, default: null },

    // ── Credential ─────────────────────────────────────────────────────
    // Only ever present on an active registration. Removed on deactivate/revoke.
    apiKeyHash: { type: String },
    keyFingerprint: { type: String },

    // Optional human-readable label.
    deviceLabel: { type: String, default: "" },
  },
  { timestamps: true }
);

// ── Pre-save invariant validation ─────────────────────────────────────────
deviceRegistrationSchema.pre("validate", function (next) {
  const d = this;
  const fail = (path, message) => {
    const err = new mongoose.Error.ValidationError(d);
    err.errors[path] = new mongoose.Error.ValidatorError({
      path,
      message,
      type: "invalid-state",
    });
    return next(err);
  };

    // Deactivated/revoked registrations never carry a credential — EXCEPT a
  // Trainer-deactivated registration, which preserves the credential so it can
  // be securely reactivated (a fresh key is issued at reactivation time).
  if (d.deactivatedAt && d.active) {
    return fail("active", "A deactivated registration cannot be active");
  }
  if (d.deactivatedAt && d.apiKeyHash && d.deactivationReason !== "trainer") {
    return fail("apiKeyHash", "A terminal deactivated registration cannot carry a credential");
  }
  if (d.revokedAt && d.active) {
    return fail("active", "A revoked registration cannot be active");
  }
  if (d.revokedAt && d.apiKeyHash) {
    return fail("apiKeyHash", "A revoked registration cannot carry a credential");
  }

  // Active registrations must carry a credential.
  if (d.active && !d.apiKeyHash) {
    return fail("apiKeyHash", "An active registration must carry a credential");
  }

  // Locked registrations must be active (can't lock an inactive registration).
  if (d.locked && !d.active) {
    return fail("locked", "A locked registration must be active");
  }

  // Deactivated/revoked registrations must not be locked.
  if (d.deactivatedAt && d.locked) {
    return fail("locked", "A deactivated registration cannot be locked");
  }
  if (d.revokedAt && d.locked) {
    return fail("locked", "A revoked registration cannot be locked");
  }

  // Locked registrations must preserve their credential.
  if (d.locked && !d.apiKeyHash) {
    return fail("apiKeyHash", "A locked registration must preserve its credential");
  }

  // Reactivation invariant: active registrations may carry reactivatedAt.
  // The deactivation reason is cleared when reactivation succeeds.
  if (d.reactivatedAt && !d.active) {
    return fail("reactivatedAt", "reactivatedAt requires active=true");
  }

  next();
});

// ── Indexes ───────────────────────────────────────────────────────────────
// INVARIANT A: one active device per Trainer.
deviceRegistrationSchema.index(
  { trainerId: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: "idx_devicereg_trainer_active_unique" }
);

// INVARIANT B: one active Trainer owner per browserDeviceId/Kiosk.
deviceRegistrationSchema.index(
  { kioskId: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: "idx_devicereg_kiosk_active_unique" }
);

// INVARIANT C: O(1) credential lookup — keyFingerprint prefilter, 1 bcrypt.
deviceRegistrationSchema.index(
  { kioskId: 1, keyFingerprint: 1 },
  { unique: true, partialFilterExpression: { keyFingerprint: { $type: "string" } }, name: "idx_devicereg_keyfp_unique" }
);

// Query index: list registrations by trainer (my devices).
deviceRegistrationSchema.index({ trainerId: 1, createdAt: -1 }, { name: "idx_devicereg_trainer_created" });

export default mongoose.model("DeviceRegistration", deviceRegistrationSchema);
