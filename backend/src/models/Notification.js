import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["export_ready", "system", "device_request"],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      default: "",
    },
    recipientRole: {
      type: String,
      enum: ["superadmin", "trainer"],
      default: "superadmin",
    },
    // Trainer-scoped recipient (device-request notifications). Superadmin
    // notifications use recipientRole only.
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    reportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AttendanceExport",
      default: null,
    },
    read: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ recipientRole: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ read: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);