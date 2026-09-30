// worker/src/s3Store.js — S3-compatible object getter for the delivery Worker.
//
// The Worker reads photos from a PRIVATE Backblaze B2 bucket (via B2's
// S3-compatible API) instead of an R2 bucket binding, so the same code works
// against any S3-compatible provider (B2, AWS, MinIO, Wasabi, R2) — only
// MEDIA_* config changes when the provider changes.
//
// Security note: this runs server-side inside the Worker. Credentials never
// reach the browser, and the public URL stays token-free (HttpOnly cookie auth
// in index.js) so immutable caching is preserved.
//
// Shaped like a minimal R2 bucket binding so `handlePhotoRequest` treats every
// backend identically: get(key) -> null | { body, size, contentType, etag }.
// 404/NoSuchKey maps to null (photo not found); anything else throws (mapped
// to 502 storage_error by the caller).

import { AwsClient } from "aws4fetch";

const isNotFound = (response) => response.status === 404;

/**
 * Build the object getter from Worker env vars.
 * Returns null when configuration is incomplete (caller fails closed with
 * server_misconfigured instead of leaking half-configured errors).
 *
 * @param {object} env  MEDIA_ENDPOINT, MEDIA_BUCKET, MEDIA_ACCESS_KEY_ID,
 *                      MEDIA_SECRET_ACCESS_KEY, MEDIA_REGION? (default us-east-1)
 * @param {object} [options]  fetchImpl — injectable fetch (tests only)
 */
export function createS3ObjectStore(env = {}, { fetchImpl } = {}) {
  const endpoint = String(env.MEDIA_ENDPOINT || "").replace(/\/+$/, "");
  const bucket = env.MEDIA_BUCKET;
  const accessKeyId = env.MEDIA_ACCESS_KEY_ID;
  const secretAccessKey = env.MEDIA_SECRET_ACCESS_KEY;
  const region = env.MEDIA_REGION || "us-east-1";

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    region,
    service: "s3",
  });
  const doFetch = fetchImpl || globalThis.fetch;
  const baseUrl = `${endpoint}/${encodeURIComponent(bucket)}`;

  return {
    provider: "s3",

    async get(key) {
      // Encode each path segment, keep "/" separators (keys are tenant paths).
      const encodedKey = String(key)
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      const request = await client.sign(`${baseUrl}/${encodedKey}`, {
        method: "GET",
      });
      const response = await doFetch(request);

      if (isNotFound(response)) {
        // Drain the body so the connection can be reused.
        await response.body?.cancel?.();
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel?.();
        throw new Error(`object storage GET failed with status ${response.status}`);
      }

      const length = Number.parseInt(response.headers.get("content-length") ?? "", 10);
      return {
        body: response.body,
        size: Number.isFinite(length) ? length : NaN,
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag"),
      };
    },
  };
}
