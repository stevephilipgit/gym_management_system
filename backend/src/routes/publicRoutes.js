import express from "express";
import memberController from "../controllers/memberController.js";
import packageController from "../controllers/packageController.js";
import { defaultLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
router.use(defaultLimiter);

/* ============================================================
   PUBLIC ROUTES (No authentication required)
============================================================ */

// GET /api/public/check-member
router.get("/check-member", memberController.checkPublicValidity);

// GET /api/public/packages
router.get("/packages", packageController.getAllPackages);

export default router;
