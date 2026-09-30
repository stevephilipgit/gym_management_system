// media/mediaService.js — media business logic (the only module member code
// talks to). Layout follows the plan's dependency chain:
//
//   memberController / kioskService
//           ↓
//       mediaService        (authorization, validation, delivery URLs)
//           ↓
//       storage adapter     (presign / head / list / remove)
//           ↓
//          object storage   (Backblaze B2 today — S3-compatible, private bucket)
//
// The backend never handles image bytes: it authorises, presigns, verifies the
// uploaded object's metadata, and stores the object key.
import { AppError } from "../core/errorHandler.js";
import { MEDIA_CONFIG } from "../config/mediaConfig.js";
import { createStorageAdapter } from "./storage.js";
import {
  buildMemberPhotoKey,
  buildPendingPhotoKey,
  parsePhotoKey,
} from "./objectKeys.js";

/** Media-specific operational errors (handled by core/errorHandler). */
export class MediaError extends AppError {
  constructor(message, statusCode, errorCode) {
    super(message, statusCode, errorCode);
  }
}

// Test seam: tests enable the pipeline with an in-memory adapter instead of
// real storage credentials. Production never calls these.
let mediaOverride = null;

export function configureMediaForTests({ enabled = true, storage = null } = {}) {
  mediaOverride = { enabled, storage };
}

export function resetMediaForTests() {
  mediaOverride = null;
  defaultStorage = null;
}

/** Effective enablement (env-derived, overridable by tests). */
export function isMediaEnabled() {
  if (mediaOverride) return mediaOverride.enabled;
  return MEDIA_CONFIG.enabled;
}

let defaultStorage = null;

export function getStorage() {
  if (mediaOverride?.storage) return mediaOverride.storage;
  if (!MEDIA_CONFIG.enabled) {
    throw new MediaError(
      "Media storage is not configured (set MEDIA_* variables or MEDIA_STORAGE_ENABLED=false)",
      503,
      "MEDIA_DISABLED"
    );
  }
  if (!defaultStorage) {
    defaultStorage = createStorageAdapter(MEDIA_CONFIG.storage.provider, MEDIA_CONFIG.storage);
  }
  return defaultStorage;
}

/** Effective limits handed to clients so validation never diverges. */
export function getMediaConstraints() {
  return {
    maxBytes: MEDIA_CONFIG.maxPhotoBytes,
    contentTypes: [...MEDIA_CONFIG.allowedContentTypes],
    presignTtlSeconds: MEDIA_CONFIG.presignTtlSeconds,
  };
}

const contentTypeForExtension = (extension) => {
  const normalized = String(extension).toLowerCase().replace(/^\./, "");
  if (normalized === "webp") return "image/webp";
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  throw new MediaError(
    "Unsupported image type. Use WebP or JPEG.",
    415,
    "MEDIA_TYPE_INVALID"
  );
};

/**
 * Authorise a photo upload and issue a short-lived presigned PUT.
 *
 * @param {object} params
 * @param {string} params.branchCode tenant scope (from the authenticated admin)
 * @param {string} [params.memberId] existing member id; omitted for
 *   registration (an in-flight `pending` key is issued instead)
 * @param {string} [params.extension] "webp" | "jpeg"
 */
export function presignPhoto({ branchCode, memberId = null, extension = "webp" } = {}) {
  if (!isMediaEnabled()) {
    throw new MediaError(
      "Photo uploads are unavailable on this server configuration",
      503,
      "MEDIA_DISABLED"
    );
  }

  const contentType = contentTypeForExtension(extension);
  let key;
  try {
    key = memberId
      ? buildMemberPhotoKey(branchCode, memberId, 1, { extension })
      : buildPendingPhotoKey(branchCode, { extension });
  } catch (error) {
    throw new MediaError(error.message, 400, "MEDIA_KEY_INVALID");
  }

  return getStorage()
    .presignPut({ key, contentType, expiresIn: MEDIA_CONFIG.presignTtlSeconds })
    .then((result) => ({
      key,
      contentType,
      maxBytes: MEDIA_CONFIG.maxPhotoBytes,
      ...result,
    }));
}

/**
 * Post-upload validation (plan §7): a presigned PUT cannot carry a max-size or
 * content guarantee on its own, so every key is verified server-side before it
 * may be referenced by a member record.
 *
 * Rejects (and deletes) objects that are missing, oversized, the wrong type,
 * or outside the caller's tenant/member scope.
 */
export async function verifyUploadedPhoto({ key, branchCode, memberId = null } = {}) {
  if (!isMediaEnabled()) {
    throw new MediaError(
      "Photo uploads are unavailable on this server configuration",
      503,
      "MEDIA_DISABLED"
    );
  }

  const parsed = parsePhotoKey(key);
  if (!parsed) {
    throw new MediaError("Invalid photo reference", 400, "MEDIA_KEY_INVALID");
  }
  if (parsed.branchCode !== String(branchCode)) {
    // Cross-tenant reference: never touch the object, just refuse.
    throw new MediaError(
      "Photo does not belong to this branch",
      403,
      "MEDIA_KEY_FORBIDDEN"
    );
  }
  if (memberId) {
    const ownsKey =
      parsed.scope === "member" && parsed.memberId === String(memberId).toLowerCase();
    if (!ownsKey) {
      throw new MediaError(
        "Photo does not belong to this member",
        403,
        "MEDIA_KEY_FORBIDDEN"
      );
    }
  } else if (parsed.scope !== "pending") {
    throw new MediaError(
      "Expected an unattached photo upload for a new member",
      400,
      "MEDIA_KEY_INVALID"
    );
  }

  const storage = getStorage();
  const object = await storage.head(key);
  if (!object) {
    throw new MediaError(
      "Photo was not uploaded. Please upload the photo again.",
      422,
      "MEDIA_OBJECT_MISSING"
    );
  }

  if (object.size > MEDIA_CONFIG.maxPhotoBytes) {
    await safeRemove(storage, key);
    throw new MediaError(
      `Photo exceeds the ${Math.floor(MEDIA_CONFIG.maxPhotoBytes / 1024)} KB limit`,
      413,
      "MEDIA_TOO_LARGE"
    );
  }

  if (!MEDIA_CONFIG.allowedContentTypes.includes(object.contentType)) {
    await safeRemove(storage, key);
    throw new MediaError(
      `Unsupported image type. Allowed: ${MEDIA_CONFIG.allowedContentTypes.join(", ")}`,
      415,
      "MEDIA_TYPE_INVALID"
    );
  }

  return { key: object.key, size: object.size, contentType: object.contentType };
}

const safeRemove = async (storage, key) => {
  try {
    await storage.remove(key);
  } catch {
    // Best effort: the orphan sweep will retry.
  }
};

/** Delivery URL for an object key (never stored in MongoDB). */
export { deliveryUrl, resolvePhotoUrl } from "./delivery.js";

/** List every object under a prefix (orphan sweep input). */
export async function listObjects(prefix, options) {
  return getStorage().list(prefix, options);
}

/** Delete one object (retention/orphan sweeps). */
export async function removeObject(key) {
  return getStorage().remove(key);
}

/** Exposed for the cleanup jobs: effective retention configuration. */
export function getCleanupConfig() {
  return {
    orphanGraceMs: MEDIA_CONFIG.cleanup.orphanGraceHours * 60 * 60 * 1000,
    previousRetentionMs: MEDIA_CONFIG.cleanup.previousRetentionDays * 24 * 60 * 60 * 1000,
  };
}
