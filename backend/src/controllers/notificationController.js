// controllers/notificationController.js - Export download + in-app notifications
//
// This is the admin-facing surface for the daily attendance export:
//   - list / mark-read in-app notifications
//   - download the generated report file
//
// Both require adminAuth; the report download and export notifications are
// restricted to Super Admins (the daily CSV contains Male + Female +
// Transgender data and is a global audit artifact — scoped trainers must not
// receive it).

import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const Notification = mongoose.model("Notification");
const AttendanceExport = mongoose.model("AttendanceExport");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Must match attendanceExportService.EXPORTS_ROOT. Lives outside the
// statically-served /uploads tree so reports are never public.
const EXPORTS_ROOT = path.join(__dirname, "..", "..", "exports");

const toPublicNotification = (n) => ({
  _id: n._id,
  type: n.type,
  title: n.title,
  message: n.message,
  reportId: n.reportId || null,
  read: n.read,
  createdAt: n.createdAt,
});

// GET /api/notifications
export const listNotifications = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  // Only superadmins currently receive notifications; scoped trainers get an
  // empty list so the global audit artifact is never exposed to them.
  if (req.admin.role !== "superadmin") {
    return res.json({ success: true, total: 0, unread: 0, notifications: [] });
  }

  const where = { recipientRole: "superadmin" };
  const [notifications, total, unread] = await Promise.all([
    Notification.find(where).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments(where),
    Notification.countDocuments({ ...where, read: false }),
  ]);

  res.json({
    success: true,
    total,
    unread,
    notifications: notifications.map(toPublicNotification),
  });
};

// PATCH /api/notifications/:id/read
export const markNotificationRead = async (req, res) => {
  if (req.admin.role !== "superadmin") {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid notification id" });
  }

  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipientRole: "superadmin" },
    { $set: { read: true, readAt: new Date() } },
    { new: true }
  );

  if (!notification) {
    return res.status(404).json({ success: false, message: "Notification not found" });
  }

  res.json({ success: true, notification: toPublicNotification(notification) });
};

// GET /api/exports/attendance/:reportId/download
export const downloadAttendanceExport = async (req, res) => {
  if (req.admin.role !== "superadmin") {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  if (!mongoose.isValidObjectId(req.params.reportId)) {
    return res.status(400).json({ success: false, message: "Invalid report id" });
  }

  const record = await AttendanceExport.findById(req.params.reportId).lean();
  if (!record) {
    return res.status(404).json({ success: false, message: "Report not found" });
  }
  if (record.status !== "ready" || !record.fileName) {
    return res.status(409).json({ success: false, message: "Report is not ready" });
  }

  // Resolve the file ONLY from server-controlled metadata; never trust client
  // input for the path. Verify the resolved path stays inside the exports root.
  const filePath = path.resolve(EXPORTS_ROOT, record.fileName);
  if (!filePath.startsWith(path.resolve(EXPORTS_ROOT) + path.sep)) {
    return res.status(403).json({ success: false, message: "Invalid report path" });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "Report file missing" });
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${record.fileName}"`);
  fs.createReadStream(filePath).pipe(res);
};