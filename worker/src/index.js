// worker/src/index.js — Cloudflare Worker in front of the PRIVATE object
// storage bucket (Backblaze B2 via its S3-compatible API).
//
// Read path (plan §9):
//   browser <img> → delivery URL (/photos/tenants/{branch}/members/…)
//     → this Worker validates the edge media cookie (shared HMAC token)
//     → fetches the object from B2 (SigV4 GET, server-side) and serves it with
//       immutable caching (plan §11)
//
// Security (plan §12):
//   * The bucket is never publicly reachable; every read goes through here and
//     carries server-side credentials (never exposed to the browser).
//   * Authorization = HMAC-signed short-lived token in an HttpOnly cookie, so
//     the image URL stays token-free and therefore immutably cacheable.
//   * The token's branch claim MUST equal the tenant segment of the object
//     key, so a token issued for one branch can never read another tenant.
//   * Revocation = let the token expire (default 15 min); no URL rewrites
//     (plan §13). Already-cached browser copies are unreachable by design.
//
// SHARED CODE: token verification reuses backend/src/media/token.js, which is
// deliberately Web-Crypto-only, so the same module runs in Node (tests) and
// the Workers runtime (wrangler bundles the relative import).

import { verifyMediaToken } from "../../backend/src/media/token.js";
import { createS3ObjectStore } from "./s3Store.js";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const NEVER_CACHE = "private, no-store";
const DEFAULT_ROUTE_PREFIX = "/photos/";
const DEFAULT_COOKIE_NAME = "gym_media_token";

/** Parse a Cookie header for one cookie value (no external deps). */
function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

/**
 * Tenant segment of an object key: "tenants/{branchCode}/members/...".
 * Returns null for anything that is not a recognised photo object key.
 */
function branchFromKey(key) {
  const parts = key.split("/");
  if (parts.length < 3 || parts[0] !== "tenants" || !parts[1]) return null;
  return parts[1];
}

function errorResponse(status, code, extraHeaders = {}) {
  return new Response(code, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Errors must never be stored at the edge or in a shared browser cache.
      "Cache-Control": NEVER_CACHE,
      "X-Media-Error": code,
      ...extraHeaders,
    },
  });
}

/**
 * Handle one photo request. Framework-agnostic so Node tests can drive it
 * directly with a mock bucket binding; the `fetch` export below is the actual
 * Worker entry point (and wires the S3-compatible store when no binding is
 * present).
 *
 * @param {Request} request
 * @param {object} env  wrangler bindings/vars:
 *   MEDIA_BUCKET (bucket binding OR bucket name), MEDIA_ENDPOINT,
 *   MEDIA_ACCESS_KEY_ID, MEDIA_SECRET_ACCESS_KEY, MEDIA_REGION?,
 *   MEDIA_TOKEN_SECRET, MEDIA_TOKEN_COOKIE?, PHOTO_ROUTE_PREFIX?
 * @returns {Promise<Response>}
 */
export async function handlePhotoRequest(request, env = {}) {
  const url = new URL(request.url);

  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(405, "method_not_allowed", { Allow: "GET, HEAD" });
  }

  const routePrefix = env.PHOTO_ROUTE_PREFIX || DEFAULT_ROUTE_PREFIX;
  if (!url.pathname.startsWith(routePrefix)) {
    return errorResponse(404, "not_found");
  }

  let key;
  try {
    key = decodeURIComponent(url.pathname.slice(routePrefix.length));
  } catch {
    return errorResponse(400, "invalid_key");
  }
  key = key.replace(/^\/+/, "");
  // No path traversal into the bucket, ever.
  if (!key || key.split("/").includes("..")) {
    return errorResponse(400, "invalid_key");
  }

  // Refuse to serve anything without a configured verification secret.
  const secret = env.MEDIA_TOKEN_SECRET;
  if (!secret) {
    return errorResponse(500, "server_misconfigured");
  }

  const cookieName = env.MEDIA_TOKEN_COOKIE || DEFAULT_COOKIE_NAME;
  const token = readCookie(request.headers.get("Cookie"), cookieName);
  const claims = await verifyMediaToken(token, { secret });
  if (!claims) {
    return errorResponse(401, "unauthorized");
  }

  // Tenant isolation: token branch must match the key's tenant segment.
  const keyBranch = branchFromKey(key);
  if (!keyBranch || keyBranch !== claims.branchCode) {
    return errorResponse(403, "tenant_mismatch");
  }

  const bucket = env.MEDIA_BUCKET;
  if (!bucket || typeof bucket.get !== "function") {
    return errorResponse(500, "server_misconfigured");
  }

  let object;
  try {
    object = await bucket.get(key);
  } catch {
    return errorResponse(502, "storage_error");
  }
  if (!object) {
    return errorResponse(404, "not_found");
  }

  const contentType =
    object.contentType ||
    object.httpMetadata?.contentType ||
    (key.endsWith(".jpg") || key.endsWith(".jpeg") ? "image/jpeg" : "image/webp");
  const etag = object.etag || object.httpMetadata?.etag || null;

  const baseHeaders = {
    "Content-Type": contentType,
    "Cache-Control": IMMUTABLE_CACHE, // keys are versioned & immutable (§11)
    "X-Content-Type-Options": "nosniff",
  };
  if (etag) baseHeaders.ETag = etag;

  // Conditional request support keeps repeat reads free (§11).
  const ifNoneMatch = request.headers.get("if-none-match");
  if (
    etag &&
    ifNoneMatch &&
    ifNoneMatch
      .split(",")
      .some((candidate) => candidate.trim() === etag || candidate.trim() === "*")
  ) {
    return new Response(null, { status: 304, headers: baseHeaders });
  }

  const headers = { ...baseHeaders };
  if (Number.isFinite(object.size)) headers["Content-Length"] = String(object.size);

  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
}

export default {
  fetch(request, env) {
    // Prefer an explicit bucket binding (tests / optional R2 compatibility);
    // otherwise read from the S3-compatible provider (B2) configured via
    // MEDIA_ENDPOINT/MEDIA_BUCKET/MEDIA_* credentials. Incomplete config
    // yields null → handlePhotoRequest fails closed (500 server_misconfigured).
    const bucket =
      env.MEDIA_BUCKET && typeof env.MEDIA_BUCKET.get === "function"
        ? env.MEDIA_BUCKET
        : createS3ObjectStore(env);
    return handlePhotoRequest(request, { ...env, MEDIA_BUCKET: bucket });
  },
};
