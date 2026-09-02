import dotenv from 'dotenv';
dotenv.config();

const config = {
  env: process.env.NODE_ENV || 'development',
  app: {
    url: process.env.APP_URL || 'http://localhost:5000',
    port: Number.parseInt(process.env.PORT || '5000', 10),
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173').split(','),
    isProduction: process.env.NODE_ENV === 'production',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET,
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
    // Dedicated secret for the short-lived Super Admin scoped-attendance token
    // (MODE 2). Falls back to the access secret ONLY for compatibility; in that
    // case strict issuer/audience/algorithm validation keeps it distinct from a
    // normal login token. Prefer a dedicated secret in production.
    adminAttendanceSecret: process.env.JWT_ADMIN_ATTENDANCE_SECRET || process.env.JWT_ACCESS_SECRET,
    adminAttendanceExpires: process.env.JWT_ADMIN_ATTENDANCE_EXPIRES || '2m',
    adminAttendanceIssuer: 'giri-gym:admin-attendance',
    adminAttendanceAudience: 'kiosk-punch',
  },
  activation: {
    // DeviceActivation TTL in seconds (MODE 1). Default 120s (short-lived).
    ttlSeconds: Number.parseInt(process.env.ACTIVATION_TTL_SECONDS || '120', 10),
  },
  db: {
    url: process.env.DATABASE_URL || process.env.MONGO_URI || process.env.MONGO_URL,
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    fieldEncryptionKey: process.env.FIELD_ENCRYPTION_KEY,
  },
  rateLimit: {
    windowMs: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    defaultMax: Number.parseInt(process.env.RATE_LIMIT_DEFAULT_MAX || '100', 10),
    loginMax: Number.parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '5', 10),
    otpMax: Number.parseInt(process.env.RATE_LIMIT_OTP_MAX || '3', 10),
  },
  email: {
    enabled: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
  },
  google: {
    enabled: !!(process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SHEET_ID),
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY,
    sheetId: process.env.GOOGLE_SHEET_ID,
  },
  ai: {
    enabled: String(process.env.AI_ENABLED).toLowerCase() === 'true',
    provider: process.env.AI_PROVIDER || 'gemini',
    model: process.env.AI_MODEL || 'gemini-1.5-flash',
    apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
    fallbackProvider: process.env.AI_FALLBACK_PROVIDER || '',
    fallbackModel: process.env.AI_FALLBACK_MODEL || '',
    fallbackApiKey: process.env.AI_FALLBACK_API_KEY || '',
  },
};

export default config;
