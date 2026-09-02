// routes/deviceRoutes.js - Trainer + Super Admin device routes
//
// Mounted behind adminAuth. Direct-activation flow:
//   - MODE 1: Trainer activates own device via 6-digit code/QR + password
//   - Super Admin generates the activation and revokes registrations
//   - Physical Kiosk inventory stays under /api/admin/kiosks
//
// Authorization is server-authoritative.

import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import adminAuth from "../middleware/adminAuth.js";
import requireRole from "../middleware/requireRole.js";
import * as activationController from "../controllers/deviceActivationController.js";
import * as deviceController from "../controllers/deviceController.js";

const router = express.Router();

// Trainer + Super Admin list of own/all device registrations.
// GET /my is the authenticated TRAINER's own attendance device (Trainer-only).
// GET /all is the Super Admin global device-management view.
router.get("/my", adminAuth, requireRole("trainer"), activationController.listMyDevices);
router.get("/all", adminAuth, requireRole("superadmin"), activationController.listAllRegistrations);

// Dedicated rate limiter for activation redemption (6-digit code → low entropy).
// 5 attempts/min per IP+Trainer key.
const activationRedeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many attempts. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ipPart = ipKeyGenerator(req);
    return `${ipPart}:${req.admin?.id || "unknown"}`;
  },
});

// Direct activation flow (Trainer-only redemption).
router.post("/activate/generate", adminAuth, requireRole("superadmin"), activationController.generate);
router.post("/activate", activationRedeemLimiter, adminAuth, requireRole("trainer"), activationController.redeem);

// Lock / revoke.
// POST /:registrationId/deactivate — Trainer locks their OWN device (Trainer-only).
// POST /:registrationId/revoke — Super Admin global revoke.
router.post("/:registrationId/deactivate", adminAuth, requireRole("trainer"), deviceController.deactivate);
router.post("/:registrationId/revoke", adminAuth, requireRole("superadmin"), deviceController.revoke);
router.post("/:registrationId/rotate", adminAuth, requireRole("superadmin"), deviceController.rotate);
router.post("/kiosks/:kioskId/reassign-scope", adminAuth, requireRole("superadmin"), deviceController.reassignScope);

export default router;