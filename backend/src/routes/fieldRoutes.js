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

// GET /api/fields/member (readable by any authenticated admin — register form renders them)
router.get("/member", adminAuth, fieldController.getAllFields);

// POST /api/fields/member (Superadmin only)
router.post("/member", adminAuth, requireRole("superadmin"), validateSchema(createFieldSchema), fieldController.createField);

// PATCH /api/fields/member/:id/toggle (Superadmin only)
router.patch("/member/:id/toggle", adminAuth, requireRole("superadmin"), fieldController.toggleField);

// PUT /api/fields/member/:id (Superadmin only) — edit an existing field
router.put("/member/:id", adminAuth, requireRole("superadmin"), validateSchema(updateFieldSchema), fieldController.updateField);

// DELETE /api/fields/member/:id
router.delete("/member/:id", adminAuth, requireRole("superadmin"), fieldController.deleteField);

export default router;
