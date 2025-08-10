import express from 'express';
import * as reportsController from '../controllers/reportsController.js';
import adminAuth from '../middleware/adminAuth.js';

const router = express.Router();

/**
 * Reports Routes
 */

// GET /api/reports/inactive - Get inactive members
router.get('/inactive', adminAuth, reportsController.getInactiveMembers);

// GET /api/reports/export/attendance - Export attendance as CSV
router.get(
  '/export/attendance',
  adminAuth,
  reportsController.exportAttendanceCSV
);

// GET /api/reports/export/members - Export members as CSV
router.get('/export/members', adminAuth, reportsController.exportMembersCSV);

// GET /api/reports/export/inactive - Export inactive members as CSV
router.get(
  '/export/inactive',
  adminAuth,
  reportsController.exportInactiveReport
);

export default router;
