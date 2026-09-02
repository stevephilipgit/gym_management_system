import express from 'express';
import * as reportsController from '../controllers/reportsController.js';
import adminAuth from '../middleware/adminAuth.js';
import requireRole from '../middleware/requireRole.js';

const router = express.Router();

/**
 * Reports Routes
 */

// GET /api/reports/inactive - Get inactive members (trainer-accessible)
router.get('/inactive', adminAuth, reportsController.getInactiveMembers);

// GET /api/reports/export/attendance - Export attendance as CSV (Super Admin only)
router.get(
  '/export/attendance',
  adminAuth,
  requireRole('superadmin'),
  reportsController.exportAttendanceCSV
);

// GET /api/reports/export/members - Export members as CSV (Super Admin only)
router.get(
  '/export/members',
  adminAuth,
  requireRole('superadmin'),
  reportsController.exportMembersCSV
);

// GET /api/reports/export/inactive - Export inactive members as CSV (trainer-accessible)
router.get(
  '/export/inactive',
  adminAuth,
  reportsController.exportInactiveReport
);

export default router;
