import express from "express";
import analyticsController from "../controllers/analyticsController.js";
import adminAuth from "../middleware/adminAuth.js";
import requireRole from "../middleware/requireRole.js";
import { adminLimiter, sensitiveLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
router.use(adminLimiter);

/* ============================================================
   ANALYTICS ROUTES
   Phase 12: analytics/revenue PDFs are SUPERADMIN-only.
============================================================ */

// GET /api/analytics/metrics
router.get("/metrics", sensitiveLimiter, adminAuth, requireRole("superadmin"), analyticsController.getMetrics);

// GET /api/analytics/export-pdf
router.get("/export-pdf", sensitiveLimiter, adminAuth, requireRole("superadmin"), analyticsController.exportPDF);

// POST /api/analytics/export-pdf
router.post("/export-pdf", sensitiveLimiter, adminAuth, requireRole("superadmin"), analyticsController.exportPDF);

export default router;
