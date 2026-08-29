import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import aiConfig from "../config/aiConfig.js";

const keyByAdmin = (req) => {
  if (req.admin?.id) return `admin:${req.admin.id}`;
  return ipKeyGenerator()(req);
};

/**
 * Per-minute rate limit keyed by authenticated admin id.
 * Falls back to IP if admin is somehow missing (shouldn't happen).
 */
export const aiPerMinuteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: aiConfig.rateLimitPerMinute,
  keyGenerator: keyByAdmin,
  message: {
    success: false,
    message: "You're sending requests too quickly. Please try again shortly.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Per-hour rate limit keyed by admin id.
 */
export const aiPerHourLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: aiConfig.rateLimitPerHour,
  keyGenerator: keyByAdmin,
  message: {
    success: false,
    message: "You've reached the hourly limit. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});