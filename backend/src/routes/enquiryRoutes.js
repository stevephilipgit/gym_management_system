/**
 * enquiryRoutes.js
 * Public: POST /api/enquiries  — no auth, strict rate limit
 * Admin:  GET/PATCH/DELETE — requires adminAuth
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import adminAuth from '../middleware/adminAuth.js';
import requireRole from '../middleware/requireRole.js';
import * as enquiryController from '../controllers/enquiryController.js';

const router = express.Router();

// Strict rate limit for public submission: 5 per 10 min per IP
const enquirySubmitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many enquiries submitted. Please try again in 10 minutes.',
  },
  skip: (req) => req.method !== 'POST',
});

// ── PUBLIC ──────────────────────────────────────────────────
// POST /api/enquiries
router.post('/', enquirySubmitLimiter, enquiryController.submitEnquiry);

// ── ADMIN ONLY ───────────────────────────────────────────────
// GET /api/enquiries
router.get('/', adminAuth, enquiryController.getEnquiries);

// GET /api/enquiries/export/csv  — must be before /:id
router.get('/export/csv', adminAuth, enquiryController.exportEnquiriesCSV);

// GET /api/enquiries/:id
router.get('/:id', adminAuth, enquiryController.getEnquiryById);

// PATCH /api/enquiries/:id/status
router.patch('/:id/status', adminAuth, enquiryController.updateEnquiryStatus);

// DELETE /api/enquiries/:id
router.delete('/:id', adminAuth, requireRole("superadmin"), enquiryController.deleteEnquiry);

export default router;
