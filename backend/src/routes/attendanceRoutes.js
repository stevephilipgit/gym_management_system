import express from 'express';
import * as attendanceController from '../controllers/attendanceController.js';
import * as attendanceValidation from '../middleware/attendanceValidation.js';
import adminAuth from '../middleware/adminAuth.js';

const router = express.Router();

/**
 * Attendance Routes
 */

// POST /api/attendance/search-punch - Combined search + attendance (from header bar)
router.post(
  '/search-punch',
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

// ========== CORRECTIONS ==========

// PUT /api/attendance/:id/correct-time - Correct check-in or check-out time
router.put(
  '/:id/correct-time',
  adminAuth,
  attendanceValidation.validateCorrectionInput,
  attendanceController.correctTime
);

// POST /api/attendance/add-missing - Add missed attendance
router.post(
  '/add-missing',
  adminAuth,
  attendanceValidation.validateMissingAttendanceInput,
  attendanceController.addMissing
);

// DELETE /api/attendance/:id - Delete duplicate attendance
router.delete(
  '/:id',
  adminAuth,
  attendanceController.deleteAttendance
);

// GET /api/attendance/search/corrections - Search for corrections
router.get(
  '/search/corrections',
  adminAuth,
  attendanceController.searchCorrections
);

export default router;
