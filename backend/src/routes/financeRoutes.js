// routes/financeRoutes.js
import express from "express";
import paymentController from "../controllers/paymentController.js";
import adminAuth from "../middleware/adminAuth.js";
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
============================================================ */

// GET /api/finance/summary/today
router.get("/summary/today", sensitiveLimiter, adminAuth, paymentController.getTodayDashboardSummary);

// GET /api/finance/today
router.get("/today", adminAuth, financeLimiter, paymentController.getTotalRevenue);

// GET /api/finance/income
router.get("/income", sensitiveLimiter, adminAuth, financeLimiter, paymentController.getIncomeSummaryByDateRange);

// GET /api/finance/analytics/age-distribution
router.get("/analytics/age-distribution", sensitiveLimiter, adminAuth, paymentController.getAgeDistribution);

// GET /api/finance/analytics/source-contribution
router.get("/analytics/source-contribution", sensitiveLimiter, adminAuth, paymentController.getSourceContribution);

// GET /api/finance/analytics/plan-distribution
router.get("/analytics/plan-distribution", sensitiveLimiter, adminAuth, paymentController.getPlanDistribution);

export default router;
