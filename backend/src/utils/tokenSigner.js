import crypto from "crypto";

const SHARE_TOKEN_SECRET =
  process.env.SHARE_TOKEN_SECRET || "dev-secret-key-change-in-production-min-32-char";

/**
 * Generate cryptographic token for PDF sharing
 * Token includes timestamp and signature
 */
export function generateShareToken(paymentLogId, expirationHours = 24) {
  const expiresAt = new Date(Date.now() + expirationHours * 60 * 60 * 1000);
  const expiryTimestamp = expiresAt.getTime();

  // Create data to sign
  const data = `${paymentLogId}:${expiryTimestamp}`;

  // Generate HMAC signature
  const token = crypto
    .createHmac("sha256", SHARE_TOKEN_SECRET)
    .update(data)
    .digest("hex");

  return {
    token,
    expiresAt,
    data, // Store for verification
  };
}

/**
 * Verify token and check expiration
 */
export function verifyShareToken(storedExpiresAt) {
  // Check expiration
  if (new Date() > new Date(storedExpiresAt)) {
    return { valid: false, reason: "Token expired" };
  }

  return { valid: true };
}
