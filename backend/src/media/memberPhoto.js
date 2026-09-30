// media/memberPhoto.js — member-facing photo attachment helpers.
//
// Everything that writes a `photoKey` onto a member document goes through here
// so the same rules always apply:
//   1. the object must exist (it was really uploaded),
//   2. it must be within the caller's tenant (and member, when one exists),
//   3. it must satisfy the size/content-type limits,
//   4. the previous photo object is RETAINED (not deleted) for the retention
//      window so devices holding the old state keep rendering.
import Branch from "../models/Branch.js";
import { ForbiddenError } from "../core/errorHandler.js";
import { isMediaEnabled, verifyUploadedPhoto } from "./mediaService.js";

/** Resolve the tenant code used in object keys (server-derived, never client). */
export async function resolveBranchCode(branchId) {
  const branch = await Branch.findById(branchId).select("code").lean();
  if (!branch || !branch.code) {
    throw new ForbiddenError("Forbidden: No branch context.");
  }
  return branch.code;
}

/**
 * Validate an uploaded object before it may be referenced by a member.
 * Throws a MediaError when the object is missing/oversized/foreign.
 */
export async function verifyMemberPhotoKey({ branchCode, photoKey, memberId = null }) {
  if (!photoKey) return null;
  if (!isMediaEnabled()) return null; // legacy mode: no media keys are accepted
  return verifyUploadedPhoto({ key: photoKey, branchCode, memberId });
}

/**
 * Build the member update fields that attach `photoKey`, retaining the object
 * it replaces so the old URL keeps working until retention cleanup runs.
 *
 * @param {object} params
 * @param {object} params.member    currently stored member (source of the old key)
 * @param {string} params.photoKey  newly uploaded object key
 * @returns {object} fields to merge into the update payload
 */
export function buildPhotoAttachUpdate({ member, photoKey }) {
  const update = { photoKey };
  const previousKey = member?.photoKey;
  if (previousKey && previousKey !== photoKey) {
    update.previousPhotos = [
      ...(member.previousPhotos || []),
      { key: previousKey, retiredAt: new Date() },
    ];
  }
  return update;
}
