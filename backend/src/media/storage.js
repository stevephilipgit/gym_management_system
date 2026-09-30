// media/storage.js — storage adapter interface for the photo media pipeline.
//
// Business code depends on this interface, never on provider SDK details
// (dependency inversion, plan §25):
//
//   presignPut({ key, contentType, expiresIn }) -> { url, method, headers }
//   head(key)   -> null | { key, size, contentType, lastModified }
//   remove(key) -> void
//   list(prefix)-> [{ key, size, lastModified }]
//
// Implementations (selected via createStorageAdapter + MEDIA_STORAGE_PROVIDER):
//   createS3Storage    — any S3-compatible object store (Backblaze B2 today;
//                        AWS S3, Cloudflare R2, MinIO, Wasabi all work) via
//                        the AWS S3 SDK (SigV4 presigned PUT)
//   createMemoryStorage — in-process fake used by tests and local runs
//
// The backend NEVER writes object bodies: uploads go browser → object storage
// directly via the presigned URL.

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const isNotFound = (error) => {
  const status = error?.$metadata?.httpStatusCode;
  const name = error?.name || error?.Code;
  return status === 404 || name === "NotFound" || name === "NoSuchKey";
};

// Every supported provider speaks the S3 API, so they all resolve to the same
// adapter; the name exists so config validation and the final report stay
// honest about what is wired up. Adding a genuinely different provider later
// means adding one entry here — business code does not change.
export const S3_COMPATIBLE_PROVIDERS = ["b2", "s3", "aws", "r2", "minio", "wasabi"];

/**
 * Map MEDIA_STORAGE_PROVIDER to an adapter instance. Unknown providers fail
 * fast with an actionable error instead of failing on the first upload.
 */
export function createStorageAdapter(provider, config) {
  const name = String(provider || "").trim().toLowerCase();
  if (name === "memory") return createMemoryStorage();
  if (S3_COMPATIBLE_PROVIDERS.includes(name)) return createS3Storage(config);
  throw new Error(
    `Unsupported MEDIA_STORAGE_PROVIDER "${provider}". ` +
      `Supported: memory, ${S3_COMPATIBLE_PROVIDERS.join(", ")}`
  );
}

/**
 * S3-compatible adapter. Backblaze B2 (and every other provider listed in
 * S3_COMPATIBLE_PROVIDERS) exposes the S3 API, so a normal S3 client pointed
 * at the provider endpoint (path-style URLs) presigns correctly. Provider
 * differences (region quirks, endpoint layout) are absorbed by config — the
 * adapter code never branches on the provider name.
 */
export function createS3Storage({
  endpoint,
  region = "us-east-1",
  accessKeyId,
  secretAccessKey,
  bucket,
}) {
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("S3-compatible storage is not fully configured");
  }

  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  return {
    provider: "s3",

    async presignPut({ key, contentType, expiresIn = 300 }) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      });
      const url = await getSignedUrl(client, command, { expiresIn });
      return {
        url,
        method: "PUT",
        // Signed headers: the client MUST send exactly these, so a PUT signed
        // for image/webp cannot be reused to store something else.
        headers: { "Content-Type": contentType },
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    },

    async head(key) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key })
        );
        return {
          key,
          size: Number(result.ContentLength ?? 0),
          contentType: result.ContentType ?? null,
          lastModified: result.LastModified ? new Date(result.LastModified) : null,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async remove(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
    },

    async list(prefix, { limit = 1000 } = {}) {
      const response = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: limit })
      );
      return (response.Contents ?? []).map((entry) => ({
        key: entry.Key,
        size: Number(entry.Size ?? 0),
        lastModified: entry.LastModified ? new Date(entry.LastModified) : null,
      }));
    },
  };
}

/**
 * In-memory adapter. `put` exists ONLY here so tests (and a local run without
 * credentials) can simulate the browser completing a presigned upload.
 */
export function createMemoryStorage() {
  const objects = new Map();

  return {
    provider: "memory",
    objects,

    async presignPut({ key, contentType, expiresIn = 300 }) {
      return {
        url: `memory://upload/${encodeURIComponent(key)}`,
        method: "PUT",
        headers: { "Content-Type": contentType },
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    },

    async put(key, { contentType = "image/webp", body = "" } = {}) {
      objects.set(key, {
        key,
        body,
        size: Buffer.byteLength(body, "utf8"),
        contentType,
        lastModified: new Date(),
      });
    },

    /** Test helper: store an object of an exact byte size (no body needed). */
    async putSized(key, { contentType = "image/webp", size = 0 } = {}) {
      objects.set(key, { key, body: null, size, contentType, lastModified: new Date() });
    },

    async head(key) {
      const found = objects.get(key);
      if (!found) return null;
      return {
        key,
        size: found.size,
        contentType: found.contentType,
        lastModified: found.lastModified,
      };
    },

    async remove(key) {
      objects.delete(key);
    },

    async list(prefix, { limit = 1000 } = {}) {
      return [...objects.values()]
        .filter((entry) => entry.key.startsWith(prefix))
        .map((entry) => ({
          key: entry.key,
          size: entry.size,
          lastModified: entry.lastModified,
        }));
    },

    /** Test helper: backdate an object so retention windows can be exercised. */
    async setLastModified(key, date) {
      const found = objects.get(key);
      if (found) found.lastModified = new Date(date);
    },
  };
}
