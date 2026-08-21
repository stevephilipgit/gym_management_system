// models/AdminSession.js - Per-device session registry for admins
//
// Each login creates one AdminSession document. Access/refresh JWTs carry a
// `sid` (session id) so individual sessions can be revoked independently.
// Logging out on Device B revokes only Device B's session; Devices A and C are
// unaffected. Password change / admin disable / admin delete revoke all
// sessions for that admin (via tokenVersion bump + bulk revoke).

import mongoose from "mongoose";

const adminSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    revokedAt: {
      type: Date,
      default: null,
      index: true,
    },
    deviceName: {
      type: String,
      default: null,
      maxlength: 200,
    },
    ip: {
      type: String,
      default: null,
      maxlength: 45,
    },
    lastSeenAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Efficient query: active sessions for an admin
adminSessionSchema.index({ adminId: 1, revokedAt: 1 });

export default mongoose.model("AdminSession", adminSessionSchema);
