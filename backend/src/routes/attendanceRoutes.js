import express from 'express';
import rateLimit from 'express-rate-limit';
import * as attendanceController from '../controllers/attendanceController.js';
import * as attendanceValidation from '../middleware/attendanceValidation.js';
import adminAuth from '../middleware/adminAuth.js';
import requireRole from '../middleware/requireRole.js';
import adminAttendanceAuth from '../middleware/adminAttendanceAuth.js';

const router = express.Router();

// Dedicated limiter for member search/punch — gymId/phone enumeration surface.
// 60 lookups / minute / IP is generous for a gym counter while capping abuse.
const searchPunchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many lookups. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/attendance/search-punch - Combined search + attendance (admin only)
router.post(
  '/search-punch',
  searchPunchLimiter,
  adminAuth,
  attendanceController.searchPunch
);

// POST /api/attendance/punch - Mark attendance (check-in or check-out)
router.post(
  '/punch',
  adminAuth,
  attendanceValidation.validatePunchInput,
  attendanceController.markAttendance
);

// POST /api/attendance/punch-manual - Handle late punch modal selection
router.post(
  '/punch-manual',
  adminAuth,
  attendanceValidation.validateLatePunchInput,
  attendanceController.handleLatePunchManual
);

// GET /api/attendance/history/:memberId - Get member's attendance history
router.get(
  '/history/:memberId',
  adminAuth,
  attendanceController.getAttendanceHistory
);

// GET /api/attendance/stats/today - Get today's stats
router.get(
  '/stats/today',
  adminAuth,
  attendanceController.getTodayStats
);

// GET /api/attendance/logs - Search attendance records by date/member (admin only)
router.get(
  '/logs',
  adminAuth,
  attendanceController.searchAttendanceLogs
);

// ── MODE 2: Super Admin scoped attendance ────────────────────────────────

// POST /api/attendance/admin-scope — issue a short-lived scope token.
// auth: adminAuth + requireRole("superadmin")
// body: { scope: "male" | "female_plus_transgender" }
const adminScopeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/admin-scope',
  adminScopeLimiter,
  adminAuth,
  requireRole('superadmin'),
  attendanceController.requestAdminScope
);

// POST /api/attendance/kiosk/admin-punch — Super Admin punches with scope token.
// auth: adminAttendanceAuth (X-Admin-Attendance-Token header)
router.post(
  '/kiosk/admin-punch',
  adminScopeLimiter,
  adminAttendanceAuth,
  attendanceController.adminKioskPunch
);

export default router;