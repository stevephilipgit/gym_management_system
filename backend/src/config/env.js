import dotenv from "dotenv";

dotenv.config();

const warnFallback = (key, fallbackSource) => {
  if (!process.env[key] && fallbackSource) {
    console.warn(`[env] ${key} missing, falling back to ${fallbackSource}`);
  }
};

warnFallback("JWT_ACCESS_SECRET", "JWT_SECRET");
warnFallback("JWT_REFRESH_SECRET", "JWT_SECRET");

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number.parseInt(process.env.PORT || "5000", 10),
  IS_PRODUCTION: process.env.NODE_ENV === "production",
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "development_access_secret_change_me",
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "development_refresh_secret_change_me",
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES || "15m",
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES || "7d",
  FIELD_ENCRYPTION_KEY:
    process.env.FIELD_ENCRYPTION_KEY || "replace_this_with_32_char_secret",
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:5173").split(","),
  RATE_LIMIT_WINDOW_MS: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  RATE_LIMIT_DEFAULT_MAX: Number.parseInt(process.env.RATE_LIMIT_DEFAULT_MAX || "100", 10),
  RATE_LIMIT_LOGIN_MAX: Number.parseInt(process.env.RATE_LIMIT_LOGIN_MAX || "5", 10),
  RATE_LIMIT_OTP_MAX: Number.parseInt(process.env.RATE_LIMIT_OTP_MAX || "3", 10),
};

export default env;
