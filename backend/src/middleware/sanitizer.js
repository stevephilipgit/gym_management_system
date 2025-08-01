import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import logger from "../core/logger.js";

export const noSqlSanitizer = mongoSanitize({
  replaceWith: "_",
  onSanitize: ({ req, key }) => {
    logger.warn(`[Security] Sanitized key "${key}" from ${req.ip}`);
  },
});

export const hppProtection = hpp();

export const sanitizeString = (str) => {
  if (typeof str !== "string") return str;
  return str
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+=/gi, "")
    .slice(0, 10000);
};
