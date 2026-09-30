// media/objectKeys.js — versioned media object keys.
//
// Structure (tenant-scoped so a key is only ever usable inside its branch):
//
//   tenants/{branchCode}/members/pending/{uploadId}/photo-{version}-{uniq}.{ext}
//   tenants/{branchCode}/members/{memberId}/photo-{version}-{uniq}.{ext}
//
// Keys are IMMUTABLE — a photo change always writes a new key, never an
// overwrite. That is what makes aggressive CDN caching safe (the plan's core
// caching rule).
//
// This module has NO Node-only imports: the Cloudflare Worker imports the
// parsing helpers to authorise a request, and `globalThis.crypto` exists in
// both runtimes.
//
// Backward compatible: nothing here touches `photoUrl` (legacy /uploads
// references), which keeps serving existing member documents untouched.

/** Branch codes are the human-readable tenant id used in counter keys. */
export const BRANCH_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const MEMBER_ID_PATTERN = /^[a-f0-9]{24}$/i;
export const UPLOAD_ID_PATTERN = /^[a-z0-9-]{8,64}$/i;
export const EXTENSION_PATTERN = /^(webp|jpe?g)$/;

// tenants/{branch}/members/(pending|{24-hex})/photo-{n}-{uniq}.{ext}
const PHOTO_KEY_PATTERN =
  /^tenants\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/members\/(?:pending\/([a-z0-9-]{8,64})|([a-f0-9]{24}))\/photo-(\d+)-([a-f0-9]{8,32})\.(webp|jpe?g)$/i;

/**
 * URL-safe random id (hex) generated from the Web Crypto global so the same
 * code runs in Node and in a Worker.
 */
export function randomHex(length = 12) {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out.slice(0, length);
}

/** Throws when the branch code cannot be embedded in a key. */
export function assertBranchCode(branchCode) {
  const code = String(branchCode ?? "").trim();
  if (!BRANCH_CODE_PATTERN.test(code)) {
    throw new Error("Invalid branch code for media key");
  }
  return code;
}

export function tenantPrefix(branchCode) {
  return `tenants/${assertBranchCode(branchCode)}/`;
}

/** Prefix used by in-flight uploads that are not yet attached to a member. */
export function pendingPhotoPrefix(branchCode) {
  return `tenants/${assertBranchCode(branchCode)}/members/pending/`;
}

/** Prefix holding one member's photo objects (active + retained previous). */
export function memberPhotoPrefix(branchCode, memberId) {
  const code = assertBranchCode(branchCode);
  const id = String(memberId ?? "").toLowerCase();
  if (!MEMBER_ID_PATTERN.test(id)) throw new Error("Invalid member id for media key");
  return `tenants/${code}/members/${id}/`;
}

/** Key for an upload that will be attached when the member is created. */
export function buildPendingPhotoKey(branchCode, { extension = "webp" } = {}) {
  const code = assertBranchCode(branchCode);
  const ext = normalizeExtension(extension);
  const uploadId = `${Date.now().toString(36)}-${randomHex(8)}`;
  return `tenants/${code}/members/pending/${uploadId}/photo-1-${randomHex(12)}.${ext}`;
}

/**
 * Key for a member's photo at `version`. The unique suffix guarantees the key
 * differs from every earlier version, so no object is ever overwritten even if
 * the version counter is reused.
 */
export function buildMemberPhotoKey(branchCode, memberId, version = 1, { extension = "webp" } = {}) {
  const prefix = memberPhotoPrefix(branchCode, memberId);
  const ext = normalizeExtension(extension);
  const v = Number.isInteger(version) && version > 0 ? version : 1;
  return `${prefix}photo-${v}-${randomHex(12)}.${ext}`;
}

export function normalizeExtension(extension) {
  const ext = String(extension ?? "").toLowerCase().replace(/^\./, "");
  if (!EXTENSION_PATTERN.test(ext)) {
    throw new Error(`Unsupported media extension: ${extension}`);
  }
  return ext === "jpg" ? "jpeg" : ext;
}

/**
 * Structural parse of a photo key.
 * @returns {null | {branchCode, scope, memberId, uploadId, version, extension}}
 */
export function parsePhotoKey(key) {
  const match = PHOTO_KEY_PATTERN.exec(String(key ?? ""));
  if (!match) return null;
  const [, branchCode, uploadId, memberId, version, , extension] = match;
  if (uploadId) {
    return {
      branchCode,
      scope: "pending",
      memberId: null,
      uploadId,
      version: Number(version),
      extension: String(extension).toLowerCase(),
    };
  }
  return {
    branchCode,
    scope: "member",
    memberId: memberId.toLowerCase(),
    uploadId: null,
    version: Number(version),
    extension: String(extension).toLowerCase(),
  };
}

/** True when the key is a well-formed photo object key at all. */
export function isPhotoObjectKey(key) {
  return parsePhotoKey(key) !== null;
}

/** True when `key` lives under the given branch's tenant prefix. */
export function isTenantOwned(key, branchCode) {
  const parsed = parsePhotoKey(key);
  return !!parsed && parsed.branchCode === String(branchCode);
}

/** True when `key` is an in-flight (not yet attached) upload for this branch. */
export function isPendingKeyFor(key, branchCode) {
  const parsed = parsePhotoKey(key);
  return !!parsed && parsed.scope === "pending" && parsed.branchCode === String(branchCode);
}

/**
 * True when `key` belongs to this branch AND this member. A pending key is
 * accepted only when `allowPending` is set (registration, before the member
 * id exists).
 */
export function isMemberKeyFor(key, branchCode, memberId, { allowPending = false } = {}) {
  const parsed = parsePhotoKey(key);
  if (!parsed || parsed.branchCode !== String(branchCode)) return false;
  if (parsed.scope === "member") return parsed.memberId === String(memberId).toLowerCase();
  return allowPending;
}
