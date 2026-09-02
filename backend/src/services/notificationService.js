// services/notificationService.js - Minimal in-app admin notification system.
//
// The ONLY in-app notification channel. There is no pre-existing notification
// system (the AdminHeader bell was a dead placeholder). Notifications are
// created only after an export record is `ready`, never carry member PII, and
// target Super Admins only (the daily report is a cross-gender audit artifact).

import mongoose from "mongoose";
import logger from "../core/logger.js";

const Notification = mongoose.model("Notification");
const AttendanceExport = mongoose.model("AttendanceExport");

function formatDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Create the "previous day report ready" notification for an export.
 * Idempotent: if the export's notificationStatus is already `sent`, does nothing.
 * On success marks notificationStatus `sent`; on failure leaves it `pending`.
 */
export async function notifyExportReady(exportRecord) {
  if (!exportRecord) return null;

  if (exportRecord.notificationStatus === "sent") {
    return null;
  }

  try {
    const existing = await Notification.findOne({ reportId: exportRecord._id });
    if (existing) {
      await AttendanceExport.updateOne(
        { _id: exportRecord._id },
        { $set: { notificationStatus: "sent" } }
      );
      return existing;
    }

    const notification = await Notification.create({
      type: "export_ready",
      title: "Daily attendance report ready",
      message: `Previous day attendance report (${formatDate(exportRecord.attendanceDate)}) is ready.`,
      recipientRole: "superadmin",
      reportId: exportRecord._id,
    });

    await AttendanceExport.updateOne(
      { _id: exportRecord._id },
      { $set: { notificationStatus: "sent" } }
    );

    logger.info(`Export notification created for ${formatDate(exportRecord.attendanceDate)}`);
    return notification;
  } catch (error) {
    logger.error("Failed to create export notification", { error: error.message });
    throw error;
  }
}

/**
 * Find `ready` exports whose notification has not yet been sent — used by the
 * retry sweep so a notification failure never regenerates the CSV.
 */
export async function getReadyExportsWithoutNotification(limit = 10) {
  return AttendanceExport.find({
    status: "ready",
    notificationStatus: { $ne: "sent" },
  })
    .sort({ attendanceDate: -1 })
    .limit(limit)
    .lean();
}
