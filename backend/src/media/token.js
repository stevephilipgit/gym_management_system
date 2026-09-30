// media/token.js — short-lived edge media authorization token.
//
// The Cloudflare Worker serves photos from the PRIVATE object-storage bucket
// (Backblaze B2 today) only for a
// valid token, so there is no token in the image URL (a query token would
// break immutable caching — see plan §12). Instead the app sets the token in
// an HttpOnly cookie scoped to the media route, and the Worker verifies it.
//
// SHARED MODULE: this file is imported by BOTH the Express backend and the
// Worker. It therefore uses only Web Crypto (globalThis.crypto.subtle) and
// standard globals — never `node:*` imports or Buffer.
//
// Token shape:  base64url(JSON payload) + "." + base64url(HMAC-SHA256)
// Payload:      { v, b: branchCode, s: subject, iat, exp }
//   v = token version, b = tenant scope checked against the object key
//   s = "admin:{id}" | "kiosk:{id}" (device/identity context)
//
// Revocation: tokens are short-lived (default 15 min), so revoking a device or
// ending a session stops NEW media access at the next refresh without needing
// to rewrite any image URL. Already-cached browser copies are, by design,
// unreachable (plan §13).

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const MEDIA_TOKEN_VERSION = 1;
const CLOCK_SKEW_SECONDS = 30;

function base64UrlEncode(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? "=".repeat(4 - (padded.length % 4)) : "";
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeSegment(text) {
  return base64UrlEncode(encoder.encode(text));
}

function decodeSegment(segment) {
  return decoder.decode(base64UrlDecode(segment));
}

async function importKey(secret) {
  if (!secret) throw new Error("MEDIA_TOKEN_SECRET is not configured");
  return globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function hmac(secret, data) {
  const key = await importKey(secret);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(signature);
}

/** Constant-time comparison of two byte arrays. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Sign a media token bound to one branch and one subject.
 * @param {object} params
 * @param {string} params.secret      HMAC secret
 * @param {string} params.branchCode  tenant scope (checked against object key)
 * @param {string} params.subject     "admin:{id}" or "kiosk:{id}"
 * @param {number} [params.ttlSeconds]
 * @param {number} [params.now]       epoch seconds (tests inject a clock)
 * @returns {Promise<string>}
 */
export async function signMediaToken({ secret, branchCode, subject, ttlSeconds = 900, now }) {
  if (!branchCode) throw new Error("branchCode is required for a media token");
  if (!subject) throw new Error("subject is required for a media token");
  const issuedAt = Math.floor(now ?? Date.now() / 1000);
  const payload = {
    v: MEDIA_TOKEN_VERSION,
    b: String(branchCode),
    s: String(subject),
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  };
  const encoded = encodeSegment(JSON.stringify(payload));
  const signature = base64UrlEncode(await hmac(secret, encoded));
  return `${encoded}.${signature}`;
}

/**
 * Verify a media token.
 * @returns {Promise<null | {branchCode, subject, issuedAt, expiresAt}>} null when
 *   the token is malformed, tampered with, or expired.
 */
export async function verifyMediaToken(token, { secret, now } = {}) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  let expected;
  try {
    expected = await hmac(secret, encoded);
  } catch {
    return null;
  }

  let provided;
  try {
    provided = base64UrlDecode(signature);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, provided)) return null;

  let payload;
  try {
    payload = JSON.parse(decodeSegment(encoded));
  } catch {
    return null;
  }

  if (!payload || payload.v !== MEDIA_TOKEN_VERSION) return null;
  if (typeof payload.b !== "string" || !payload.b) return null;
  if (typeof payload.s !== "string" || !payload.s) return null;
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null;

  const current = Math.floor(now ?? Date.now() / 1000);
  if (current > payload.exp + CLOCK_SKEW_SECONDS) return null;
  if (payload.iat - CLOCK_SKEW_SECONDS > current) return null;

  return {
    branchCode: payload.b,
    subject: payload.s,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

/** Cookie attributes used when the app hands the token to the browser. */
export function mediaTokenCookieOptions({ ttlSeconds = 900, isProduction = false } = {}) {
  return {
    httpOnly: true,
    secure: isProduction,
    // SameSite=Lax keeps the cookie on normal navigations while still blocking
    // cross-site POSTs; the Worker only needs it on image GETs from our pages.
    sameSite: "lax",
    path: "/",
    maxAge: ttlSeconds,
  };
}
