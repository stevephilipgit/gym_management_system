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

  const googleKeys = ['GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID'];
  const googleSet = googleKeys.filter((k) => process.env[k]);
  if (googleSet.length > 0 && googleSet.length < googleKeys.length) {
    console.warn('[Config] Partial Google config detected. Sheets sync will be disabled.');
  }
}
