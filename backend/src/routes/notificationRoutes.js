// routes/notificationRoutes.js - Admin notification + export download routes
//
// Mounted behind adminAuth; role enforcement happens in the controller.
// These routes expose the daily attendance report to authenticated Super
// Admins only — kiosk principals and customers can never reach them.

import express from "express";
import adminAuth from "../middleware/adminAuth.js";
import {
  listNotifications,
  markNotificationRead,
  downloadAttendanceExport,
} from "../controllers/notificationController.js";

const router = express.Router();

// GET  /api/notifications            — list notifications (superadmin)
router.get("/", adminAuth, listNotifications);

// PATCH /api/notifications/:id/read  — mark a notification as read
router.patch("/:id/read", adminAuth, markNotificationRead);

export default router;

export const exportDownloadRouter = express.Router();

// GET /api/exports/attendance/:reportId/download — download a ready report
exportDownloadRouter.get(
  "/attendance/:reportId/download",
  adminAuth,
  downloadAttendanceExport
);