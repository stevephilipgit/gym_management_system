import mongoose from "mongoose";

const attendanceExportSchema = new mongoose.Schema(
  {
    attendanceDate: {
      type: Date,
      required: true,
    },
    exportType: {
      type: String,
      enum: ["daily"],
      default: "daily",
    },
    status: {
      type: String,
      enum: ["pending", "generating", "ready", "failed"],
      default: "pending",
    },
    generatingStartedAt: {
      type: Date,
      default: null,
    },
    fileName: {
      type: String,
      default: null,
    },
    filePath: {
      type: String,
      default: null,
    },
    rowCount: {
      type: Number,
      default: null,
    },
    fileSize: {
      type: Number,
      default: null,
    },
    failedReason: {
      type: String,
      default: null,
    },
    notificationStatus: {
      type: String,
      enum: ["none", "pending", "sent"],
      default: "none",
    },
    createdBy: {
      type: String,
      default: "SYSTEM",
    },
  },
  { timestamps: true }
);

attendanceExportSchema.index({ attendanceDate: 1, exportType: 1 }, { unique: true });

export default mongoose.model("AttendanceExport", attendanceExportSchema);