// config/mediaConfig.js — single source of truth for the member photo media
// pipeline (presigned object-storage uploads + edge-delivered photo URLs).
//
// Re-exported as `config.media` by config/index.js. New code should prefer
// importing MEDIA_CONFIG directly.
//
// Provider-agnostic: MEDIA_STORAGE_PROVIDER selects the storage adapter
// ("b2" today — Backblaze B2 via its S3-compatible API; "s3"/"aws"/"minio"/
// "wasabi"/"r2" share the same S3-compatible adapter). Switching providers is
// a config change only: set MEDIA_STORAGE_PROVIDER + MEDIA_* credentials and
// the pipeline keeps working with zero code changes.
//
// Env names (preferred): MEDIA_STORAGE_PROVIDER, MEDIA_BUCKET, MEDIA_ENDPOINT,
// MEDIA_REGION, MEDIA_ACCESS_KEY_ID, MEDIA_SECRET_ACCESS_KEY,
// MEDIA_PUBLIC_BASE_URL, MEDIA_STORAGE_ENABLED. Legacy R2_* /
// PHOTO_CDN_BASE_URL / MEDIA_R2_ENABLED names still work as deprecated
// fallbacks so an old .env keeps behaving exactly as before.
//
// Rollback switch: MEDIA_STORAGE_ENABLED=false (legacy MEDIA_R2_ENABLED)
// forces the media pipeline OFF even when credentials are present, which
// restores the previous multipart-to-disk behaviour (see routes/memberRoutes.js).
// Without credentials the pipeline is off by default, so local/dev setups keep
// working unchanged.
import dotenv from "dotenv";

dotenv.config();

const boolFromEnv = (value) => String(value ?? "").toLowerCase() === "true";
const falseFromEnv = (value) => String(value ?? "").toLowerCase() === "false";

const intFromEnv = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const trim = (value) => String(value ?? "").trim();

// First non-empty value among the given env names (preferred name first).
const firstEnv = (...names) => {
  for (const name of names) {
    const value = trim(process.env[name]);
    if (value) return value;
  }
  return "";
};

// Adapter selection. Every supported provider today speaks the S3 API; the
// registry in media/storage.js maps the name to the right adapter. Unknown
// names fail fast at storage construction (mediaService.getStorage), not on
// the first upload.
const storage = {
  provider: firstEnv("MEDIA_STORAGE_PROVIDER") || "b2",
  bucket: firstEnv("MEDIA_BUCKET", "R2_BUCKET"),
  endpoint: firstEnv("MEDIA_ENDPOINT", "R2_ENDPOINT"),
  region: firstEnv("MEDIA_REGION", "R2_REGION") || "us-east-1",
  accessKeyId: firstEnv("MEDIA_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"),
  secretAccessKey: firstEnv("MEDIA_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY"),
};

const hasStorageCredentials = Boolean(
  storage.endpoint && storage.accessKeyId && storage.secretAccessKey && storage.bucket
);

// `enabled` is derived, never hard-coded: credentials present AND not
// explicitly disabled. A partial credential set is treated as disabled rather
// than half-configured (safer than failing on the first upload).
const enabledFlag = firstEnv("MEDIA_STORAGE_ENABLED", "MEDIA_R2_ENABLED");
const mediaEnabled = hasStorageCredentials && !falseFromEnv(enabledFlag);

const deliveryBaseUrl = firstEnv("MEDIA_PUBLIC_BASE_URL", "PHOTO_CDN_BASE_URL") ||
  `${trim(process.env.APP_URL) || "http://localhost:5000"}/photos`;

export const MEDIA_CONFIG = {
  enabled: mediaEnabled,
  storage,
  // Public delivery base for photo keys. In production this is the Worker
  // route in front of the private bucket (MEDIA_PUBLIC_BASE_URL), e.g.
  // https://media.example.com/photos — never the raw bucket.
  deliveryBaseUrl: deliveryBaseUrl.replace(/\/+$/, ""),
  // How long a presigned PUT stays valid. Short by design: the client should
  // request and use it immediately.
  presignTtlSeconds: intFromEnv(process.env.MEDIA_PRESIGN_TTL_SECONDS, 300),
  // Hard server-side cap enforced by post-upload verification (a presigned PUT
  // cannot carry a max-size constraint on its own).
  maxPhotoBytes: intFromEnv(process.env.MEDIA_MAX_PHOTO_BYTES, 300 * 1024),
  allowedContentTypes: ["image/webp", "image/jpeg"],
  token: {
    // Dedicated edge-auth secret for short-lived media tokens. Falls back to
    // the JWT access secret (validateEnv warns in production), but a dedicated
    // value is preferred for key separation between JWT signing and edge auth.
    secret: trim(process.env.MEDIA_TOKEN_SECRET) || process.env.JWT_ACCESS_SECRET,
    ttlSeconds: intFromEnv(process.env.MEDIA_TOKEN_TTL_SECONDS, 900),
    cookieName: trim(process.env.MEDIA_TOKEN_COOKIE) || "gym_media_token",
    // Only needed when the media route lives on ANOTHER origin than the API
    // (e.g. api.example.com issues, media.example.com serves). Set it to the
    // shared parent domain (".example.com") so the Worker receives the cookie.
    // Leave unset for the recommended same-origin /photos route.
    cookieDomain: trim(process.env.MEDIA_TOKEN_COOKIE_DOMAIN) || undefined,
  },
  cleanup: {
    // Orphans younger than this are never deleted (upload may still be in
    // flight / the Mongo write may still be pending).
    orphanGraceHours: intFromEnv(process.env.MEDIA_ORPHAN_GRACE_HOURS, 24),
    // Previous photo versions stay readable this long so devices that have not
    // yet fetched the new member state keep working.
    previousRetentionDays: intFromEnv(process.env.MEDIA_PREVIOUS_RETENTION_DAYS, 14),
  },
  enabledFlagSet: boolFromEnv(enabledFlag),
};

export default MEDIA_CONFIG;
