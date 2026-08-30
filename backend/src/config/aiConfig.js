import dotenv from "dotenv";
dotenv.config();

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

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

  timeoutMs: toInt(process.env.AI_TIMEOUT_MS, 15000),

  rateLimitPerMinute: toInt(process.env.AI_RATE_LIMIT_PER_MINUTE, 20),
  rateLimitPerHour: toInt(process.env.AI_RATE_LIMIT_PER_HOUR, 100),

  maxMessageLength: toInt(process.env.AI_MAX_MESSAGE_LENGTH, 2000),
  maxHistoryPairs: toInt(process.env.AI_MAX_HISTORY_PAIRS, 10),
  maxContextLength: toInt(process.env.AI_MAX_CONTEXT_LENGTH, 10000),
  maxMemoryItems: toInt(process.env.AI_MAX_MEMORY_ITEMS, 50),

  // Hard context budget (approximate characters, not tokens). The system
  // prompt + memory + bounded history + current message must fit within it.
  maxToolResultRows: toInt(process.env.AI_MAX_TOOL_RESULT_ROWS, 20),
  maxToolResultChars: toInt(process.env.AI_MAX_TOOL_RESULT_CHARS, 4000),

  // Retention / lifecycle (days).
  sessionArchiveDays: toInt(process.env.AI_SESSION_ARCHIVE_DAYS, 90),
  sessionRetentionDays: toInt(process.env.AI_SESSION_RETENTION_DAYS, 365),
};

export default aiConfig;