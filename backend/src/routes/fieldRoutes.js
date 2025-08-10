// routes/fieldRoutes.js
import express from "express";
import fieldController from "../controllers/fieldController.js";
import adminAuth from "../middleware/adminAuth.js";
import requireRole from "../middleware/requireRole.js";
import { validateSchema } from "../middleware/schemaValidator.js";
import { createFieldSchema, updateFieldSchema } from "../schemas/fieldSchema.js";
import { adminLimiter, sensitiveLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
router.use(adminLimiter);

/* ============================================================
   FIELD ROUTES
============================================================ */

// GET /api/fields/member
router.get("/member", adminAuth, fieldController.getAllFields);

// POST /api/fields/member
router.post("/member", adminAuth, validateSchema(createFieldSchema), fieldController.createField);

// PATCH /api/fields/member/:id/toggle
router.patch("/member/:id/toggle", adminAuth, fieldController.toggleField);

// DELETE /api/fields/member/:id
router.delete("/member/:id", adminAuth, requireRole("superadmin"), fieldController.deleteField);

export default router;
