import express from "express";
import analyticsController from "../controllers/analyticsController.js";
import adminAuth from "../middleware/adminAuth.js";
import { adminLimiter, sensitiveLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
router.use(adminLimiter);

/* ============================================================
   ANALYTICS ROUTES
============================================================ */

// GET /api/analytics/metrics
router.get("/metrics", sensitiveLimiter, adminAuth, analyticsController.getMetrics);

// GET /api/analytics/export-pdf
router.get("/export-pdf", sensitiveLimiter, adminAuth, analyticsController.exportPDF);

// POST /api/analytics/export-pdf
router.post("/export-pdf", sensitiveLimiter, adminAuth, analyticsController.exportPDF);

export default router;
