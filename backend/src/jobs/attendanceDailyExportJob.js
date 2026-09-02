// jobs/attendanceDailyExportJob.js - Scheduled previous-day attendance export.
//
// Runs once daily shortly after midnight (IST). Generates the CSV for the
// previous IST calendar day via attendanceExportService (idempotent, crash
// safe), then creates a superadmin notification when the report is ready.
//
// Notification is created ONLY after the export record is `ready`; if the
// notification write fails the export stays `ready` and a later run retries
// the notification WITHOUT regenerating the CSV.

import mongoose from "mongoose";
import { generateDailyExport } from "../services/attendanceExportService.js";
import { notifyExportReady, getReadyExportsWithoutNotification } from "../services/notificationService.js";
import logger from "../core/logger.js";

const AttendanceExport = mongoose.model("AttendanceExport");

export async function attendanceDailyExportJob(now = new Date()) {
  try {
    // Previous IST calendar day (Attendance.date is the check-in business day).
    const previousDay = new Date(now);
    previousDay.setDate(previousDay.getDate() - 1);
    previousDay.setHours(0, 0, 0, 0);

    const record = await generateDailyExport(previousDay, now);
    if (!record) {
      logger.warn("Daily export job: no export record produced");
      return { success: false, reason: "no_record" };
    }

    if (record.status === "ready") {
      await notifyExportReady(record);
    }

    return { success: true, status: record.status, attendanceDate: previousDay };
  } catch (error) {
    logger.error("Daily export job failed", { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Retry notifications for exports that are `ready` but not yet notified.
 * Never regenerates the CSV — it only retries the notification delivery.
 */
export async function retryPendingNotifications() {
  const readyExports = await getReadyExportsWithoutNotification();
  let notified = 0;
  for (const record of readyExports) {
    try {
      const recordDoc = await AttendanceExport.findById(record._id);
      if (!recordDoc) continue;
      await notifyExportReady(recordDoc);
      notified += 1;
    } catch (error) {
      logger.error(`Notification retry failed for export ${record.attendanceDate}`, {
        error: error.message,
      });
    }
  }
  return { success: true, notified };
}

/**
 * Retention cleanup — bounded, idempotent, missing-file tolerant.
 *
 * Deletion is DISABLED until the business owner sets export_retention_days > 0
 * in SystemSettings. When enabled, ready exports older than the cutoff are
 * removed (file + metadata + their notification) in a single bounded pass.
 */
export async function cleanupExpiredExports(settings) {
  const retentionDays = Number(settings?.export_retention_days) || 0;
  if (retentionDays <= 0) {
    logger.info("Export retention disabled (export_retention_days <= 0) — no cleanup");
    return { success: true, deleted: 0, disabled: true };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  cutoff.setHours(0, 0, 0, 0);

  const expired = await AttendanceExport.find({
    status: "ready",
    attendanceDate: { $lt: cutoff },
  })
    .select("_id filePath fileName")
    .limit(100)
    .lean();

  let deleted = 0;
  for (const record of expired) {
    try {
      // Missing files are tolerated — delete metadata regardless.
      if (record.filePath) {
        const { unlink } = await import("fs/promises");
        await unlink(record.filePath).catch(() => {});
      }
      await AttendanceExport.deleteOne({ _id: record._id });
      const Notification = mongoose.model("Notification");
      await Notification.deleteMany({ reportId: record._id });
      deleted += 1;
    } catch (error) {
      logger.error(`Export cleanup failed for ${record._id}`, { error: error.message });
    }
  }

  if (deleted > 0) {
    logger.info(`Export retention cleanup removed ${deleted} reports older than ${retentionDays} days`);
  }
  return { success: true, deleted };
}