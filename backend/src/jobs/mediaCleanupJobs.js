// jobs/mediaCleanupJobs.js — member photo lifecycle cleanup.
//
// Two sweeps, both storage-side (no image bytes ever pass through Node):
//
//   orphanPhotoCleanup  — objects NOBODY references: the browser upload
//                         succeeded but the MongoDB write failed or never ran.
//                         Safety window of 24h, so an upload that is still in
//                         flight (or a transaction that is about to commit) is
//                         never touched.
//   retiredPhotoCleanup — objects replaced by a newer photo. They are RETAINED
//                         for 14 days so devices that have not yet fetched the
//                         new member state keep rendering, then removed.
//
// Guarantees:
//   * never deletes an object referenced as a member's active photoKey
//   * never deletes anything younger than the safety window
//   * only ever deletes well-formed photo object keys under tenants/
//   * both are no-ops while the media pipeline is disabled (rollback mode)
import Member from "../models/Member.js";
import logger from "../core/logger.js";
import {
  getCleanupConfig,
  isMediaEnabled,
  listObjects,
  removeObject,
} from "../media/mediaService.js";
import { isPhotoObjectKey } from "../media/objectKeys.js";

const MEDIA_ROOT_PREFIX = "tenants/";

/**
 * Every object key currently referenced by a member — the active photo plus
 * every photo still inside its retention window.
 */
async function collectReferencedKeys() {
  const referenced = new Set();
  const cursor = Member.find({
    $or: [
      { photoKey: { $ne: null, $exists: true } },
      { previousPhotos: { $exists: true, $ne: [] } },
    ],
  })
    .select("photoKey previousPhotos")
    .lean()
    .cursor();

  for await (const doc of cursor) {
    if (doc.photoKey) referenced.add(doc.photoKey);
    for (const entry of doc.previousPhotos || []) {
      if (entry?.key) referenced.add(entry.key);
    }
  }
  return referenced;
}

/**
 * Delete unreferenced photo objects older than the safety window.
 * @param {object} [options]
 * @param {number} [options.now]  epoch ms (tests inject a clock)
 * @param {boolean} [options.dryRun] report without deleting
 */
export async function orphanPhotoCleanup({ now = Date.now(), dryRun = false } = {}) {
  if (!isMediaEnabled()) {
    logger.info("MEDIA_ORPHAN_CLEANUP_SKIPPED", { reason: "media pipeline disabled" });
    return { skipped: true, scanned: 0, deleted: 0, keptReferenced: 0, keptRecent: 0 };
  }

  const { orphanGraceMs } = getCleanupConfig();
  const cutoff = now - orphanGraceMs;

  const referenced = await collectReferencedKeys();
  const objects = await listObjects(MEDIA_ROOT_PREFIX);

  const deletedKeys = [];
  let keptReferenced = 0;
  let keptRecent = 0;
  let keptNotPhoto = 0;
  let failed = 0;

  for (const object of objects) {
    if (referenced.has(object.key)) {
      keptReferenced += 1;
      continue;
    }
    // Defensive: never delete anything that is not a photo object key we manage.
    if (!isPhotoObjectKey(object.key)) {
      keptNotPhoto += 1;
      continue;
    }
    const lastModified = object.lastModified ? new Date(object.lastModified).getTime() : null;
    if (lastModified === null || lastModified > cutoff) {
      keptRecent += 1;
      continue;
    }

    try {
      if (!dryRun) await removeObject(object.key);
      deletedKeys.push(object.key);
    } catch (error) {
      failed += 1;
      logger.error("MEDIA_ORPHAN_CLEANUP_DELETE_FAILED", {
        key: object.key,
        error: error.message,
      });
    }
  }

  const summary = {
    skipped: false,
    dryRun: Boolean(dryRun),
    scanned: objects.length,
    referenced: referenced.size,
    deleted: deletedKeys.length,
    keptReferenced,
    keptRecent,
    keptNotPhoto,
    failed,
    orphanAgeHours: Math.round(orphanGraceMs / 3600000),
  };
  logger.info("MEDIA_ORPHAN_CLEANUP", summary);
  return { ...summary, deletedKeys };
}

/**
 * Delete photo objects that were replaced more than the retention window ago,
 * and drop their entries from the member record.
 * @param {object} [options]
 * @param {number} [options.now]  epoch ms (tests inject a clock)
 * @param {boolean} [options.dryRun] report without deleting
 */
export async function retiredPhotoCleanup({ now = Date.now(), dryRun = false } = {}) {
  if (!isMediaEnabled()) {
    logger.info("MEDIA_PHOTO_RETENTION_SKIPPED", { reason: "media pipeline disabled" });
    return { skipped: true, scanned: 0, deleted: 0 };
  }

  const { previousRetentionMs } = getCleanupConfig();
  const cutoff = now - previousRetentionMs;

  const members = await Member.find({
    "previousPhotos.retiredAt": { $lt: new Date(cutoff) },
  })
    .select("photoKey previousPhotos")
    .lean();

  const deletedKeys = [];
  let kept = 0;
  let failed = 0;

  for (const member of members) {
    for (const entry of member.previousPhotos || []) {
      if (!entry?.key || !entry.retiredAt) continue;
      // Safety: never remove the object a member is actively serving.
      if (member.photoKey && entry.key === member.photoKey) {
        kept += 1;
        continue;
      }
      if (new Date(entry.retiredAt).getTime() > cutoff) {
        kept += 1;
        continue;
      }

      try {
        if (!dryRun) {
          await removeObject(entry.key);
          await Member.updateOne(
            { _id: member._id },
            { $pull: { previousPhotos: { key: entry.key } } }
          );
        }
        deletedKeys.push(entry.key);
      } catch (error) {
        failed += 1;
        logger.error("MEDIA_RETENTION_DELETE_FAILED", {
          memberId: String(member._id),
          key: entry.key,
          error: error.message,
        });
      }
    }
  }

  const summary = {
    skipped: false,
    dryRun: Boolean(dryRun),
    scannedMembers: members.length,
    deleted: deletedKeys.length,
    kept,
    failed,
    retentionDays: Math.round(previousRetentionMs / 86400000),
  };
  logger.info("MEDIA_PHOTO_RETENTION", summary);
  return { ...summary, deletedKeys };
}

export default { orphanPhotoCleanup, retiredPhotoCleanup };
