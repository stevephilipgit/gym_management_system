import rateLimit from "express-rate-limit";

const limiterMessage = {
  success: false,
  message: "Too many requests to AI assistant. Please wait.",
};

export const aiRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: limiterMessage,
  standardHeaders: true,
  legacyHeaders: false,
});

export const aiStrictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: limiterMessage,
  standardHeaders: true,
  legacyHeaders: false,
});
