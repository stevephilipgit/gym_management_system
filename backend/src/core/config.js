// core/config.js - Centralized configuration
import dotenv from "dotenv";
import mongoose from "mongoose";
import { createClient } from "redis";

dotenv.config();

// ============= ENVIRONMENT VARIABLES =============

const warnFallback = (key, fallbackSource) => {
  if (!process.env[key] && fallbackSource) {
    console.warn(`[config] ${key} missing, falling back to ${fallbackSource}`);
  }
};

warnFallback("JWT_ACCESS_SECRET", "JWT_SECRET");
warnFallback("JWT_REFRESH_SECRET", "JWT_SECRET");

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number.parseInt(process.env.PORT || "5000", 10),
  IS_PRODUCTION: process.env.NODE_ENV === "production",
  MONGO_URI: process.env.MONGO_URI || process.env.MONGO_URL || "mongodb://localhost:27017/gym_management",
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "development_access_secret_change_me",
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "development_refresh_secret_change_me",
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES || "15m",
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES || "7d",
  FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY || "replace_this_with_32_char_secret",
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:5173").split(","),
  RATE_LIMIT_WINDOW_MS: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  RATE_LIMIT_DEFAULT_MAX: Number.parseInt(process.env.RATE_LIMIT_DEFAULT_MAX || "100", 10),
  RATE_LIMIT_LOGIN_MAX: Number.parseInt(process.env.RATE_LIMIT_LOGIN_MAX || "5", 10),
  RATE_LIMIT_OTP_MAX: Number.parseInt(process.env.RATE_LIMIT_OTP_MAX || "3", 10),
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};

// ============= MONGODB CONNECTION =============

export const connectDB = async () => {
  try {
    await mongoose.connect(env.MONGO_URI);
    console.log("✅ MongoDB Connected Successfully!");
  } catch (err) {
    console.error("❌ MongoDB Connection Failed:", err.message);
    process.exit(1);
  }
};

// ============= REDIS CONNECTION =============

export const redisClient = createClient({
  url: env.REDIS_URL,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) => {
      if (retries > 5) {
        console.error("[Redis] Too many reconnect attempts. Giving up.");
        return false;
      }
      return Math.min(retries * 200, 2000);
    },
  },
});

redisClient.on("connect", () => console.log("[Redis] Connected"));
redisClient.on("error", (err) => console.error("[Redis] Error:", err.message));
redisClient.on("reconnecting", () => console.log("[Redis] Reconnecting..."));

redisClient.connect().catch((err) => {
  console.error("[Redis] Initial connection failed:", err.message);
});

// ============= EXPORTS =============

export default env;
