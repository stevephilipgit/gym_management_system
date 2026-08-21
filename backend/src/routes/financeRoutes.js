// routes/financeRoutes.js
import express from "express";
import paymentController from "../controllers/paymentController.js";
import adminAuth from "../middleware/adminAuth.js";
import requireRole from "../middleware/requireRole.js";
import rateLimit from "express-rate-limit";
import { adminLimiter, sensitiveLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
router.use(adminLimiter);

/* -----------------------------------------
   RATE LIMITER
----------------------------------------- */
const financeLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 10,
  message: { message: "Too many requests, slow down." },
});

/* ============================================================
   FINANCE ROUTES
   Phase 12: the revenue DASHBOARD is SUPERADMIN-only. Trainers
   (male/female) must not access finance aggregates. The frontend
   dashboard route is also RoleGuard-wrapped.
============================================================ */

// GET /api/finance/summary/today
router.get("/summary/today", sensitiveLimiter, adminAuth, requireRole("superadmin"), paymentController.getTodayDashboardSummary);

// GET /api/finance/today
router.get("/today", adminAuth, requireRole("superadmin"), financeLimiter, paymentController.getTotalRevenue);

// GET /api/finance/income
router.get("/income", sensitiveLimiter, adminAuth, requireRole("superadmin"), financeLimiter, paymentController.getIncomeSummaryByDateRange);

// GET /api/finance/analytics/age-distribution
router.get("/analytics/age-distribution", sensitiveLimiter, adminAuth, requireRole("superadmin"), paymentController.getAgeDistribution);

// GET /api/finance/analytics/source-contribution
router.get("/analytics/source-contribution", sensitiveLimiter, adminAuth, requireRole("superadmin"), paymentController.getSourceContribution);

// GET /api/finance/analytics/plan-distribution
router.get("/analytics/plan-distribution", sensitiveLimiter, adminAuth, requireRole("superadmin"), paymentController.getPlanDistribution);

export default router;
