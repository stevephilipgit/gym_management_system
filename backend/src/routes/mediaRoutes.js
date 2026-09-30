//  mediaRoutes.js — member photo media endpoints
//
//   GET    /api/media/config         delivery base + limits (rate-limited)
//   POST   /api/media/presign        signed PUT for a photo upload (admin)
//   POST   /api/media/session        edge media cookie (admin session)
//   POST   /api/media/session/kiosk  edge media cookie (kiosk device)
//   DELETE /api/media/session        drop the edge media cookie
//
// No image bytes ever pass through these routes.

import express from "express";
import rateLimit from "express-rate-limit";
import mediaController from "../controllers/mediaController.js";
import adminAuth from "../middleware/adminAuth.js";
import kioskAuth from "../middleware/kioskAuth.js";
import { validateSchema } from "../middleware/schemaValidator.js";
import { mediaPresignSchema } from "../schemas/mediaSchema.js";

const router = express.Router();

const message = (text) => ({ success: false, message: text });

// Presigning is per-upload work, so the budget is generous but still bounded.
const presignLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: message("Too many upload requests, slow down."),
});

// Session creation is meant to be called once per client (then refreshed), so
// it gets a much tighter budget than presigning.
const sessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: message("Too many media session requests, slow down."),
});

const configLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: message("Too many requests, slow down."),
});

router.get("/config", configLimiter, mediaController.getMediaConfig);

router.post(
  "/presign",
  presignLimiter,
  adminAuth,
  validateSchema(mediaPresignSchema),
  mediaController.presignPhoto
);

router.post("/session", sessionLimiter, adminAuth, mediaController.createAdminMediaSession);
router.post("/session/kiosk", sessionLimiter, kioskAuth, mediaController.createKioskMediaSession);
router.delete("/session", mediaController.clearMediaSession);

export default router;
