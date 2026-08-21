import express from "express";
import dietController from "../controllers/dietController.js";
import adminAuth from "../middleware/adminAuth.js";
import requireRole from "../middleware/requireRole.js";
import { validateSchema } from "../middleware/schemaValidator.js";
import { createDietSchema, updateDietSchema } from "../schemas/dietSchema.js";
import { adminLimiter, defaultLimiter, sensitiveLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
router.use(defaultLimiter);

/**
 * POST /api/diets
 * Create new diet
 */
router.post("/", adminLimiter, adminAuth, validateSchema(createDietSchema), dietController.createDiet);

/**
 * GET /api/diets
 * List all active diets (admin only — not needed by public website)
 */
router.get("/", sensitiveLimiter, adminAuth, dietController.getAllDiets);

// GET /api/diets/:id
router.get("/:id", sensitiveLimiter, adminAuth, dietController.getDietById);

// PUT /api/diets/:id
router.put("/:id", adminLimiter, adminAuth, validateSchema(updateDietSchema), dietController.updateDiet);

// DELETE /api/diets/:id
// Global rule: ONLY SUPERADMIN can delete. Trainers/finance get 403.
router.delete("/:id", adminLimiter, adminAuth, requireRole("superadmin"), dietController.deleteDiet);

export default router;
