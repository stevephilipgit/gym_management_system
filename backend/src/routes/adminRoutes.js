// gym_project_backend/routes/adminRoutes.js
import express from "express";
import rateLimit from "express-rate-limit";
import authController from "../controllers/authController.js";
import adminAuth from "../middleware/adminAuth.js";
import requireRole from "../middleware/requireRole.js";
import { validateSchema } from "../middleware/schemaValidator.js";
import { loginSchema, createAdminSchema, changePasswordSchema } from "../schemas/authSchema.js";
import { adminLimiter, otpLimiter, sensitiveLimiter, captchaLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
router.use(adminLimiter);

/* ============================================================
   LOGIN RATE LIMITER (Security)
============================================================ */
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  message: { message: "Too many login attempts. Try again in a few minutes." },
});

/* ============================================================
   ADMIN ROUTES
============================================================ */

// POST /api/admin/login
router.post("/login", loginLimiter, validateSchema(loginSchema), authController.login);

// GET /api/admin/captcha - issue a server-validated CAPTCHA challenge
router.get("/captcha", captchaLimiter, authController.getCaptcha);

// POST /api/admin/refresh - rotate expired access token using the refresh cookie
router.post("/refresh", sensitiveLimiter, authController.refreshToken);

// GET /api/admin/me
router.get("/me", sensitiveLimiter, adminAuth, authController.getCurrentAdmin);

// POST /api/admin/logout
router.post("/logout", adminAuth, authController.logout);

// POST /api/admin/create (Superadmin only)
router.post("/create", adminAuth, requireRole("superadmin"), validateSchema(createAdminSchema), authController.createAdmin);

// PUT /api/admin/:id (Superadmin only)
router.put("/:id", adminAuth, requireRole("superadmin"), authController.updateAdmin);

// DELETE /api/admin/:id (Superadmin only)
router.delete("/:id", adminAuth, requireRole("superadmin"), authController.deleteAdmin);

// GET /api/admin/list (Superadmin only)
router.get("/list", adminAuth, requireRole("superadmin"), authController.listAdmins);

// POST /api/admin/change-password
router.post("/change-password", adminAuth, validateSchema(changePasswordSchema), authController.changePassword);

// POST /api/admin/reset-password/:id (Superadmin only)
router.post("/reset-password/:id", adminAuth, requireRole("superadmin"), authController.resetAdminPassword);

// POST /api/admin/forgot
router.post("/forgot", otpLimiter, authController.forgotPassword);

// POST /api/admin/reset
router.post("/reset", otpLimiter, authController.resetPasswordWithOTP);

export default router;
