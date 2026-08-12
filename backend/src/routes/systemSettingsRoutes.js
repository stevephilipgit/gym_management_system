import express from 'express';
import * as systemSettingsController from '../controllers/systemSettingsController.js';
import adminAuth from '../middleware/adminAuth.js';
import requireRole from '../middleware/requireRole.js';

const router = express.Router();

/**
 * System Settings Routes
 */

// GET /api/settings - Get settings (superadmin only — trainer/finance never need them)
router.get('/', adminAuth, requireRole('superadmin'), systemSettingsController.getSettings);

// PUT /api/settings - Update settings (admin only)
router.put(
  '/',
  adminAuth,
  requireRole('superadmin'),
  systemSettingsController.updateSettings
);

export default router;
