import mongoose from "mongoose";
import logger from "../core/logger.js";

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    adminUsername: { type: String, default: null },
    requestId: { type: String, default: null },
    ipAddress: { type: String, required: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    statusCode: { type: Number },
    userAgent: { type: String },
    action: { type: String },
    resourceType: { type: String, default: null },
    resourceId: { type: String, default: null },
    changes: { type: mongoose.Schema.Types.Mixed, default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { collection: "auditlogs", timestamps: false }
);

export const AuditLog =
  mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);

export const auditLogger = (req, res, next) => {
  res.on("finish", () => {
    const shouldLog =
      req.path.includes("/auth") ||
      req.path.includes("/admin") ||
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);

    if (!shouldLog) return;

    AuditLog.create({
      userId: req.admin?.id || null,
      ipAddress: req.ip,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      userAgent: req.get("User-Agent"),
      action: `${req.method} ${req.path} -> ${res.statusCode}`,
    }).catch((err) => logger.error("[AuditLog] Write failed:", err.message));
  });

  next();
};
