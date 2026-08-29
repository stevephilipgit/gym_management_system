// gym_project_backend/models/Admin.js
import mongoose from "mongoose";

const AdminSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    role: {
      type: String,
      enum: ["superadmin", "trainer"],
      default: "trainer",
    },

    scope: {
      type: String,
      enum: ["all", "male", "female_plus_transgender"],
      default: "all",
    },

    // account lifecycle: 'active' admins may authenticate; 'disabled' admins
    // are rejected by adminAuth and all their sessions are revoked
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
    },

    // bumped to invalidate every outstanding JWT for this admin
    // (password change, admin disable, role/scope change)
    tokenVersion: {
      type: Number,
      default: 0,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    lastLogin: {
      type: Date,
      default: null,
    },

    resetOtp: {
      type: String,
      default: null,
    },

    otpExpiry: {
      type: Number,
      default: null,
    },

    // Per-admin UI preferences (e.g. All Members filter state). A shallow
    // object keyed by feature name; persists per admin across sessions.
    preferences: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model("Admin", AdminSchema);
