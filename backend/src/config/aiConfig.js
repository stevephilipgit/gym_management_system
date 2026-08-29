import dotenv from "dotenv";
dotenv.config();

const aiConfig = {
  enabled: String(process.env.AI_ENABLED || "false").toLowerCase() === "true",

  provider: process.env.AI_PROVIDER || "gemini",
  model: process.env.AI_MODEL || "gemini-1.5-flash",
  apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || "",
  baseUrl: process.env.AI_BASE_URL || "",

  fallbackProvider: process.env.AI_FALLBACK_PROVIDER || "",
  fallbackModel: process.env.AI_FALLBACK_MODEL || "",
  fallbackApiKey: process.env.AI_FALLBACK_API_KEY || "",
  fallbackBaseUrl: process.env.AI_FALLBACK_BASE_URL || "",

  timeoutMs: Number.parseInt(process.env.AI_TIMEOUT_MS || "15000", 10),

  rateLimitPerMinute: Number.parseInt(process.env.AI_RATE_LIMIT_PER_MINUTE || "20", 10),
  rateLimitPerHour: Number.parseInt(process.env.AI_RATE_LIMIT_PER_HOUR || "100", 10),

  maxMessageLength: Number.parseInt(process.env.AI_MAX_MESSAGE_LENGTH || "2000", 10),
  maxHistoryPairs: Number.parseInt(process.env.AI_MAX_HISTORY_PAIRS || "10", 10),
  maxContextLength: Number.parseInt(process.env.AI_MAX_CONTEXT_LENGTH || "10000", 10),
  maxMemoryItems: Number.parseInt(process.env.AI_MAX_MEMORY_ITEMS || "50", 10),
};

export default aiConfig;