// models/DraftRegistration.js - Per-session registration draft
//
// Each draft is scoped by (adminId, sessionId, draftType) so only the same
// authenticated session may read/update/delete it. TTL cleanup via MongoDB
// (the updatedAt field has a TTL index). Sensitive fields (Aadhaar, phone,
// medical) are stored but never logged or exposed in URLs.

import mongoose from "mongoose";

const draftRegistrationSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
    sessionId: { type: String, required: true },
    draftType: { type: String, default: "register", maxlength: 50 },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Efficient query by (adminId, sessionId) — the primary access pattern.
draftRegistrationSchema.index({ adminId: 1, sessionId: 1 });

// TTL: auto-clean drafts older than 7 days.
draftRegistrationSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export default mongoose.model("DraftRegistration", draftRegistrationSchema);