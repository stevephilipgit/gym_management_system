// utils/auditLog.js - Structured audit logging
import logger from "../core/logger.js";
import { ACTION_TYPES } from "../core/constants.js";

export const auditLog = async (req, details) => {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId: req.id,
      adminId: req.admin?.id || null,
      adminUsername: req.admin?.username || null,
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode: req.res?.statusCode || null,
      action: details.action,
      status: details.status || "SUCCESS",
      resourceType: details.resourceType || null,
      resourceId: details.resourceId || null,
      changes: details.changes || null,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: details.details || null,
    };

    // Log to Winston
    const logLevel = logEntry.status === "SUCCESS" ? "info" : "warn";
    logger[logLevel](
      `[${logEntry.action}] Resource: ${logEntry.resourceType || "N/A"} (${logEntry.resourceId || "N/A"})`,
      logEntry
    );

    // Store in database if available
    if (req.app.locals.auditLogModel) {
      await req.app.locals.auditLogModel.create(logEntry);
    }

    return logEntry;
  } catch (err) {
    logger.error("Failed to create audit log", { error: err.message });
  }
};

// Helper for common audit log actions
export const auditActions = {
  async memberCreated(req, memberId, memberData) {
    return auditLog(req, {
      action: ACTION_TYPES.MEMBER_CREATE,
      status: "SUCCESS",
      resourceType: "Member",
      resourceId: memberId,
      changes: memberData,
    });
  },

  async memberUpdated(req, memberId, changes) {
    return auditLog(req, {
      action: ACTION_TYPES.MEMBER_UPDATE,
      status: "SUCCESS",
      resourceType: "Member",
      resourceId: memberId,
      changes,
    });
  },

  async memberDeleted(req, memberId) {
    return auditLog(req, {
      action: ACTION_TYPES.MEMBER_DELETE,
      status: "SUCCESS",
      resourceType: "Member",
      resourceId: memberId,
    });
  },

  async paymentCreated(req, paymentId, amount) {
    return auditLog(req, {
      action: ACTION_TYPES.PAYMENT_CREATE,
      status: "SUCCESS",
      resourceType: "Payment",
      resourceId: paymentId,
      changes: { amount },
    });
  },

  async paymentRefunded(req, paymentId, refundAmount) {
    return auditLog(req, {
      action: ACTION_TYPES.PAYMENT_REFUND,
      status: "SUCCESS",
      resourceType: "Payment",
      resourceId: paymentId,
      changes: { refundAmount },
    });
  },

  async adminLogin(req, adminId, success = true) {
    return auditLog(req, {
      action: ACTION_TYPES.ADMIN_LOGIN,
      status: success ? "SUCCESS" : "FAILED",
      resourceType: "Admin",
      resourceId: adminId,
    });
  },

  async adminLogout(req, adminId) {
    return auditLog(req, {
      action: ACTION_TYPES.ADMIN_LOGOUT,
      status: "SUCCESS",
      resourceType: "Admin",
      resourceId: adminId,
    });
  },

  async attendanceMarked(req, memberId, date) {
    return auditLog(req, {
      action: ACTION_TYPES.ATTENDANCE_MARK,
      status: "SUCCESS",
      resourceType: "Attendance",
      resourceId: memberId,
      changes: { date },
    });
  },

  // ✅ NEW: Attendance audit helpers
  async duplicatePunchBlocked(req, memberId) {
    return auditLog(req, {
      action: "DUPLICATE_PUNCH_BLOCKED",
      status: "BLOCKED",
      resourceType: "Attendance",
      resourceId: memberId,
      details: "Duplicate punch within configured window",
    });
  },

  async expiredMemberBlocked(req, memberId, reason) {
    return auditLog(req, {
      action: "EXPIRED_MEMBER_BLOCKED",
      status: "BLOCKED",
      resourceType: "Member",
      resourceId: memberId,
      details: reason,
    });
  },

  async settingsUpdated(req, updates) {
    return auditLog(req, {
      action: "SETTINGS_UPDATED",
      status: "SUCCESS",
      resourceType: "SystemSettings",
      resourceId: "gym_rules",
      changes: updates,
    });
  },

  async startupRecovery(recoveredCount, date) {
    return logger.info("Startup recovery completed", {
      action: "STARTUP_RECOVERY",
      recoveredCount,
      date,
    });
  },
};

export default auditLog;
