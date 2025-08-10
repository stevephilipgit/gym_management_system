// gym_project_backend/routes/packageRoutes.js
import express from "express";
import packageController from "../controllers/packageController.js";
import adminAuth from "../middleware/adminAuth.js";
import requireRole from "../middleware/requireRole.js";
import { validateSchema } from "../middleware/schemaValidator.js";
import { createPackageSchema, updatePackageSchema } from "../schemas/packageSchema.js";
import { adminLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
router.use(adminLimiter);

/* ============================================================
   PACKAGE ROUTES
============================================================ */

// GET /api/packages
router.get("/", adminAuth, packageController.getAllPackages);

// POST /api/packages
router.post("/", adminAuth, validateSchema(createPackageSchema), packageController.createPackage);

// PUT /api/packages/:id
router.put("/:id", adminAuth, validateSchema(updatePackageSchema), packageController.updatePackage);

// DELETE /api/packages/:id (Superadmin only)
router.delete("/:id", adminAuth, requireRole("superadmin"), packageController.deletePackage);

export default router;
