/**
 * Member Photo Media Pipeline — Phase 4 (lifecycle cleanup jobs).
 *
 * Covers jobs/mediaCleanupJobs.js:
 *   ORPHAN SWEEP   — unreferenced objects older than the 24h safety window are
 *                    deleted; recent orphans, referenced objects, and anything
 *                    that is not a managed photo key are never touched
 *   RETENTION SWEEP— replaced photos are deleted + unlinked only after the
 *                    14-day retention window; recent ones and the active
 *                    photoKey are always kept
 *   ROLLBACK       — both sweeps are no-ops while the pipeline is disabled
 *
 * Storage is the in-memory adapter (no storage credentials required). Requires
 * MongoDB; SKIPS when unreachable, matching the other integration suites.
 *
 * Run: cd backend && npm test
 */

import mongoose from "mongoose";
import { expect } from "chai";
import dotenv from "dotenv";

dotenv.config();

import "../models/Member.js";
import Member from "../models/Member.js";
import { MEDIA_CONFIG } from "../config/mediaConfig.js";
import {
  configureMediaForTests,
  resetMediaForTests,
} from "../media/mediaService.js";
import { createMemoryStorage } from "../media/storage.js";
import {
  buildMemberPhotoKey,
  buildPendingPhotoKey,
} from "../media/objectKeys.js";
import { orphanPhotoCleanup, retiredPhotoCleanup } from "../jobs/mediaCleanupJobs.js";
import { seedTestBranch } from "./utils/branchFixture.js";

const DB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/gym_test";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.now();

const randomDigits = (count) =>
  Array.from({ length: count }, () => Math.floor(Math.random() * 10)).join("");

describe("Media cleanup jobs (integration)", function () {
  this.timeout(30000);

  let branch;
  let storage;
  let memberSeq = 0;

  const createMember = async (overrides = {}) => {
    memberSeq += 1;
    const stamp = Date.now().toString().slice(-6);
    return Member.create({
      branchId: branch._id,
      gymId: Number(`${stamp}${randomDigits(4)}`),
      memberCode: `MC${stamp}${memberSeq}`,
      fullName: "Cleanup Member",
      fatherName: "Cleanup Father",
      dob: new Date("1994-05-05"),
      bloodGroup: "B+",
      gender: "Male",
      address: "9 Cleanup Street",
      aadhar: randomDigits(12),
      occupation: "Teacher",
      phone: `7${randomDigits(9)}`,
      gymPlan: "1 Month",
      trainingType: "Weight Loss",
      paymentStatus: "not_paid",
      status: "active",
      version: 0,
      ...overrides,
    });
  };

  /** Create an object directly in storage (simulates a finished upload). */
  const putObject = async (key, { ageMs = 0, contentType = "image/webp" } = {}) => {
    await storage.putSized(key, { contentType, size: 2048 });
    await storage.setLastModified(key, new Date(NOW - ageMs));
    return key;
  };

  const objectExists = async (key) => Boolean(await storage.head(key));

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
    } catch (err) {
      this.skip();
    }
    branch = await seedTestBranch();
    // Pre-wipe leftovers from prior runs: the schema's save hook rewrites
    // fullName to "Cleanup Member C." so exact matches never fired.
    await Member.deleteMany({ fullName: /^Cleanup Member/ }).catch(() => {});
  });

  after(async function () {
    resetMediaForTests();
    if (mongoose.connection.readyState === 1) {
      await Member.deleteMany({ fullName: /^Cleanup Member/ }).catch(() => {});
    }
  });

  beforeEach(function () {
    storage = createMemoryStorage();
    configureMediaForTests({ enabled: true, storage });
  });

  afterEach(async function () {
    resetMediaForTests();
    await Member.deleteMany({ fullName: /^Cleanup Member/ }).catch(() => {});
  });

  /* ============================================================
     ORPHAN SWEEP
     ============================================================ */
  describe("orphanPhotoCleanup", () => {
    it("deletes an unreferenced object older than the safety window", async () => {
      const orphanKey = buildPendingPhotoKey(branch.code); // never attached
      await putObject(orphanKey, { ageMs: 25 * HOUR });

      const result = await orphanPhotoCleanup({ now: NOW });

      expect(result.skipped).to.equal(false);
      expect(result.deletedKeys).to.include(orphanKey);
      expect(await objectExists(orphanKey)).to.equal(false);
    });

    it("keeps an unreferenced object that is still inside the safety window", async () => {
      const youngKey = buildPendingPhotoKey(branch.code);
      await putObject(youngKey, { ageMs: 2 * HOUR });

      const result = await orphanPhotoCleanup({ now: NOW });

      expect(result.deletedKeys).to.not.include(youngKey);
      expect(result.keptRecent).to.be.at.least(1);
      expect(await objectExists(youngKey)).to.equal(true);
    });

    it("never touches the active photo of an existing member, however old", async () => {
      const member = await createMember();
      const photoKey = buildMemberPhotoKey(branch.code, String(member._id), 1);
      member.photoKey = photoKey;
      await member.save();
      await putObject(photoKey, { ageMs: 60 * DAY }); // ancient but referenced

      const result = await orphanPhotoCleanup({ now: NOW });

      expect(result.deletedKeys).to.not.include(photoKey);
      expect(await objectExists(photoKey)).to.equal(true);
    });

    it("never touches an object retained in previousPhotos", async () => {
      const member = await createMember();
      const retainedKey = buildMemberPhotoKey(branch.code, String(member._id), 1);
      member.previousPhotos = [{ key: retainedKey, retiredAt: new Date(NOW - 2 * DAY) }];
      member.markModified("previousPhotos");
      await member.save();
      await putObject(retainedKey, { ageMs: 30 * DAY });

      const result = await orphanPhotoCleanup({ now: NOW });

      expect(result.deletedKeys).to.not.include(retainedKey);
      expect(await objectExists(retainedKey)).to.equal(true);
    });

    it("never deletes objects that are not managed photo keys", async () => {
      const foreignKey = `tenants/${branch.code}/misc/notes.txt`;
      await putObject(foreignKey, { ageMs: 60 * DAY, contentType: "text/plain" });

      const result = await orphanPhotoCleanup({ now: NOW });

      expect(result.deletedKeys).to.not.include(foreignKey);
      expect(result.keptNotPhoto).to.be.at.least(1);
      expect(await objectExists(foreignKey)).to.equal(true);
    });

    it("dry run reports the same set without deleting anything", async () => {
      const orphanKey = buildPendingPhotoKey(branch.code);
      await putObject(orphanKey, { ageMs: 25 * HOUR });

      const dry = await orphanPhotoCleanup({ now: NOW, dryRun: true });
      expect(dry.deletedKeys).to.include(orphanKey);
      expect(await objectExists(orphanKey)).to.equal(true);

      const live = await orphanPhotoCleanup({ now: NOW });
      expect(live.deletedKeys).to.include(orphanKey);
      expect(await objectExists(orphanKey)).to.equal(false);
    });

    it("is a no-op while the media pipeline is disabled", async () => {
      const orphanKey = buildPendingPhotoKey(branch.code);
      await putObject(orphanKey, { ageMs: 25 * HOUR });
      configureMediaForTests({ enabled: false, storage });

      const result = await orphanPhotoCleanup({ now: NOW });

      expect(result.skipped).to.equal(true);
      expect(result.deleted).to.equal(0);
      expect(await objectExists(orphanKey)).to.equal(true);
    });
  });

  /* ============================================================
     RETENTION SWEEP
     ============================================================ */
  describe("retiredPhotoCleanup", () => {
    const retentionMs = MEDIA_CONFIG.cleanup.previousRetentionDays * DAY;

    it("deletes and unlinks a replaced photo older than the retention window", async () => {
      const member = await createMember();
      const oldKey = buildMemberPhotoKey(branch.code, String(member._id), 1);
      const activeKey = buildMemberPhotoKey(branch.code, String(member._id), 2);
      member.photoKey = activeKey;
      member.previousPhotos = [{ key: oldKey, retiredAt: new Date(NOW - retentionMs - HOUR) }];
      member.markModified("previousPhotos");
      await member.save();
      await putObject(oldKey, { ageMs: retentionMs + HOUR });
      await putObject(activeKey, { ageMs: HOUR });

      const result = await retiredPhotoCleanup({ now: NOW });

      expect(result.deletedKeys).to.include(oldKey);
      expect(await objectExists(oldKey)).to.equal(false);
      expect(await objectExists(activeKey)).to.equal(true);

      const stored = await Member.findById(member._id).lean();
      expect(stored.photoKey).to.equal(activeKey);
      expect(stored.previousPhotos).to.have.length(0);
    });

    it("keeps a replaced photo that is still inside the retention window", async () => {
      const member = await createMember();
      const recentKey = buildMemberPhotoKey(branch.code, String(member._id), 1);
      const activeKey = buildMemberPhotoKey(branch.code, String(member._id), 2);
      member.photoKey = activeKey;
      member.previousPhotos = [{ key: recentKey, retiredAt: new Date(NOW - 2 * DAY) }];
      member.markModified("previousPhotos");
      await member.save();
      await putObject(recentKey, { ageMs: 2 * DAY });

      const result = await retiredPhotoCleanup({ now: NOW });

      expect(result.deletedKeys).to.not.include(recentKey);
      expect(await objectExists(recentKey)).to.equal(true);

      const stored = await Member.findById(member._id).lean();
      expect(stored.previousPhotos).to.have.length(1);
      expect(stored.previousPhotos[0].key).to.equal(recentKey);
    });

    it("never removes an entry whose key is the member's active photo", async () => {
      const member = await createMember();
      const activeKey = buildMemberPhotoKey(branch.code, String(member._id), 3);
      // Defensive: a malformed record listing the active key as "previous".
      member.photoKey = activeKey;
      member.previousPhotos = [{ key: activeKey, retiredAt: new Date(NOW - retentionMs - HOUR) }];
      member.markModified("previousPhotos");
      await member.save();
      await putObject(activeKey, { ageMs: retentionMs + HOUR });

      const result = await retiredPhotoCleanup({ now: NOW });

      expect(result.deletedKeys).to.not.include(activeKey);
      expect(await objectExists(activeKey)).to.equal(true);

      const stored = await Member.findById(member._id).lean();
      expect(stored.previousPhotos).to.have.length(1);
    });

    it("only scans members that actually have expired retained photos", async () => {
      const member = await createMember(); // no photos at all
      const result = await retiredPhotoCleanup({ now: NOW });

      expect(result.skipped).to.equal(false);
      expect(result.scannedMembers).to.equal(0);
      expect(result.deleted).to.equal(0);
      expect(await Member.findById(member._id)).to.not.equal(null);
    });

    it("dry run reports without deleting the object or touching the record", async () => {
      const member = await createMember();
      const oldKey = buildMemberPhotoKey(branch.code, String(member._id), 1);
      member.photoKey = buildMemberPhotoKey(branch.code, String(member._id), 2);
      member.previousPhotos = [{ key: oldKey, retiredAt: new Date(NOW - retentionMs - HOUR) }];
      member.markModified("previousPhotos");
      await member.save();
      await putObject(oldKey, { ageMs: retentionMs + HOUR });

      const result = await retiredPhotoCleanup({ now: NOW, dryRun: true });

      expect(result.deletedKeys).to.include(oldKey);
      expect(await objectExists(oldKey)).to.equal(true);
      const stored = await Member.findById(member._id).lean();
      expect(stored.previousPhotos).to.have.length(1);
    });

    it("is a no-op while the media pipeline is disabled", async () => {
      const member = await createMember();
      const oldKey = buildMemberPhotoKey(branch.code, String(member._id), 1);
      member.photoKey = buildMemberPhotoKey(branch.code, String(member._id), 2);
      member.previousPhotos = [{ key: oldKey, retiredAt: new Date(NOW - retentionMs - HOUR) }];
      member.markModified("previousPhotos");
      await member.save();
      await putObject(oldKey, { ageMs: retentionMs + HOUR });
      configureMediaForTests({ enabled: false, storage });

      const result = await retiredPhotoCleanup({ now: NOW });

      expect(result.skipped).to.equal(true);
      expect(await objectExists(oldKey)).to.equal(true);
      const stored = await Member.findById(member._id).lean();
      expect(stored.previousPhotos).to.have.length(1);
    });
  });
});
