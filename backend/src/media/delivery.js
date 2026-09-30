// media/delivery.js — photo delivery URL resolution.
//
// Kept deliberately free of storage SDK imports: it is imported by the Member
// model's serialization path, so it must stay cheap (no AWS SDK load).
//
// Contract:
//   photoKey present  → serve from the private-bucket delivery route
//                       (Worker → Backblaze B2 via its S3 API, immutable
//                       caching is safe because keys are versioned and never
//                       overwritten)
//   photoKey absent   → legacy `photoUrl` (`/uploads/...`) so every existing
//                       member document keeps rendering exactly as before
import { MEDIA_CONFIG } from "../config/mediaConfig.js";

/** Public delivery URL for an object key. Never persisted. */
export function deliveryUrl(key) {
  if (!key) return null;
  return `${MEDIA_CONFIG.deliveryBaseUrl}/${String(key).replace(/^\/+/, "")}`;
}

/**
 * Resolve a member's photo for an API response.
 * Prefers the active media key, falls back to the legacy local-disk reference.
 */
export function resolvePhotoUrl(member) {
  if (!member) return null;
  if (member.photoKey) return deliveryUrl(member.photoKey);
  return member.photoUrl || null;
}

export default { deliveryUrl, resolvePhotoUrl };
