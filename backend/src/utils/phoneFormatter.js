/**
 * Format phone number for database storage (10 digits)
 * Example: "+91 98765 43210" -> "9876543210"
 */
export function formatPhoneForStorage(phone) {
  if (!phone) throw new Error("Phone number required");

  // Remove all non-digits
  const cleaned = phone.replace(/\D/g, "");

  // If 12 digits and starts with 91, remove country code
  if (cleaned.length === 12 && cleaned.startsWith("91")) {
    return cleaned.substring(2);
  }

  // If 10 digits, return as-is
  if (cleaned.length === 10) {
    return cleaned;
  }

  throw new Error("Invalid phone format. Must be 10 digits or 91 + 10 digits");
}

/**
 * Format phone number for WhatsApp Web URL
 * Returns: 919876543210
 */
export function formatPhoneForWhatsApp(phone) {
  const stored = formatPhoneForStorage(phone);
  return `91${stored}`;
}

/**
 * Validate phone format (10 digits)
 */
export function validatePhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, "");
  return /^\d{10}$/.test(cleaned);
}
