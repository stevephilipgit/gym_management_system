// models/Branch.js - Physical gym location (multi-tenancy root)
//
// Every tenant-scoped document (Member, FinanceLog, PaymentLog, DailySummary,
// Attendance, Package, Enquiry, Kiosk, Admin) carries a required `branchId`
// referencing this model. Admins are branch-bound: a superadmin's authority
// covers exactly one branch (Branch SuperAdmin), trainers inherit the branch
// of their account plus their gender scope.
//
// `code` is the stable machine identifier used in counter keys
// (e.g. gym_id_MATHUR_M) and must never change once issued.

import mongoose from "mongoose";

const branchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    // Stable machine code, e.g. "MATHUR". Unique; uppercased on write.
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: [/^[A-Z0-9_-]+$/, "code may only contain letters, numbers, - and _"],
    },

    // Inactive branches are excluded from reconciliation loops and new-write
    // resolution, but their historical documents remain queryable.
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Branch", branchSchema);
