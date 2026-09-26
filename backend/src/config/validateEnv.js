import dotenv from 'dotenv';
dotenv.config();

export function validateEnv() {
  const required = ['JWT_ACCESS_SECRET', 'FIELD_ENCRYPTION_KEY', 'DATABASE_URL'];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`${key} is required. Server cannot start.`);
    }
  }

  const smtpKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const smtpSet = smtpKeys.filter((k) => process.env[k]);
  if (smtpSet.length > 0 && smtpSet.length < smtpKeys.length) {
    console.warn('[Config] Partial SMTP config detected. Email will be disabled.');
  }

  // Kiosk selection-token HMAC secret. Not fatal (config falls back to the JWT
  // access secret) but key separation is recommended — warn at startup.
  if (!process.env.KIOSK_SELECTION_SECRET) {
    console.warn('[Config] KIOSK_SELECTION_SECRET is not set. Falling back to JWT_ACCESS_SECRET for kiosk selection tokens; set a dedicated secret in production.');
  }
}
