import helmet from "helmet";
import config from "../config/index.js";

// Build connectSrc from configured origins (ALLOWED_ORIGINS env var)
// In development this includes localhost; in production only the real origins.
const connectSrcOrigins = config.app.allowedOrigins.map((o) => {
  try {
    const url = new URL(o);
    return url.origin;
  } catch {
    return o;
  }
});

export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", ...connectSrcOrigins],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.app.isProduction ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: config.app.isProduction
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
});

export const additionalHeaders = (req, res, next) => {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
};
