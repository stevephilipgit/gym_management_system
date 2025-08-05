import { RateLimiterRedis } from "rate-limiter-flexible";
import redisClient from "../config/redis.js";
import env from "../config/env.js";

const createLimiter = (keyPrefix, points, durationSeconds) => {
  const limiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix,
    points,
    duration: durationSeconds,
    blockDuration: durationSeconds,
  });

  return async (req, res, next) => {
    const identifier = req.user?.id || req.admin?.id || req.ip;
    try {
      await limiter.consume(identifier);
      next();
    } catch (error) {
      if (typeof error?.msBeforeNext !== "number") {
        return next();
      }

      const retryAfter = Math.ceil(error.msBeforeNext / 1000);
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        retryAfterSeconds: retryAfter,
      });
    }
  };
};

export const defaultLimiter = createLimiter(
  "rl_default",
  env.RATE_LIMIT_DEFAULT_MAX,
  env.RATE_LIMIT_WINDOW_MS / 1000
);
export const loginLimiter = createLimiter("rl_login", env.RATE_LIMIT_LOGIN_MAX, 60);
export const otpLimiter = createLimiter("rl_otp", env.RATE_LIMIT_OTP_MAX, 300);
export const adminLimiter = createLimiter("rl_admin", 300, 60);
export const sensitiveLimiter = createLimiter("rl_sensitive", 50, 60);
