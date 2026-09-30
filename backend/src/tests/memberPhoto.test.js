/**
 * Member Photo Media Pipeline â€” Phase 3 (member integration).
 *
 * Covers wiring the media pipeline into the member lifecycle:
 *   REGISTER  â€” photoKey attached after post-upload verification; unknown key
 *               rejected before the member is created; legacy multipart path
 *               still works when the pipeline is disabled
 *   UPDATE    â€” photoKey replaces the active object, the previous object is
 *               RETAINED (never deleted at write time)
 *   PUT PHOTO â€” dedicated photo-only endpoint: attach, 409 on version conflict
 *   READ      â€” `member.photoUrl` in API responses resolves to the delivery URL
 *               when a media key exists, legacy value otherwise
 *
 * Storage is the in-memory adapter (no storage credentials required). Requires
 * MongoDB (replica set for the registration transaction); SKIPS when
 * unreachable, matching the other integration suites.
 *
 * Run: cd backend && npm test
 */

import mongoose from "mongoose";
import { expect } from "chai";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

import "../models/Admin.js";
import "../models/AdminSession.js";
import "../models/Member.js";
import "../models/Diet.js"; // registered for memberRepository's dietId populate
import Admin from "../models/Admin.js";
import AdminSession from "../models/AdminSession.js";
import Member from "../models/Member.js";
import config from "../config/index.js";
import { errorHandler } from "../core/errorHandler.js";
import memberRoutes from "../routes/memberRoutes.js";
import { memberController } from "../controllers/memberController.js";
import { makeAdminReq, makeRes, runRoute } from "./utils/routeRunner.js";
import {
  configureMediaForTests,
  deliveryUrl,
  presignPhoto,
  resetMediaForTests,
} from "../media/mediaService.js";
import { createMemoryStorage } from "../media/storage.js";
import { buildPunchResponse } from "../utils/attendanceInput.js";
import { seedTestBranch, seedSecondBranch } from "./utils/branchFixture.js";

const DB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/gym_test";

const randomDigits = (count) =>
  Array.from({ length: count }, () => Math.floor(Math.random() * 10)).join("");

/** Response bodies hold live mongoose docs â€” serialize like Express does. */
const serialize = (res) => JSON.parse(JSON.stringify(res.body ?? null));

describe("Member photo integration (integration)", function () {
  this.timeout(30000);

  let branch;
  let otherBranch;
  let superadmin;
  let saSession;
  let saToken;
  let storage;

  const makeAdmin = async (role, scope) => {
    const username = `memphoto_${role}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return Admin.create({
      fullName: "Member Photo Admin",
      branchId: branch._id,
      username,
      email: `${username}@example.com`,
      role,
      scope,
      passwordHash: "x",
      status: "active",
      tokenVersion: 0,
    });
  };

  const makeSession = (adminId) =>
    AdminSession.create({
      sessionId: crypto.randomUUID(),
      adminId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: null,
    });

  const signAccess = (admin, sid) =>
    jwt.sign(
      {
        id: admin._id,
        username: admin.username,
        role: admin.role,
        scope: admin.scope,
        email: admin.email,
        sid,
        tv: 0,
      },
      config.jwt.accessSecret,
      { expiresIn: "15m" }
    );

  const adminReq = (overrides = {}) =>
    makeAdminReq({ session: saSession, token: saToken, overrides });

  const runMemberRoute = (method, path, overrides = {}) =>
    runRoute(memberRoutes, method, path, adminReq(overrides));

  /** Simulate the browser finishing a presigned upload into storage. */
  const uploadPhoto = async ({ memberId = null, extension = "webp", size = 1024 } = {}) => {
    const { key } = await presignPhoto({
      branchCode: branch.code,
      memberId,
      extension,
    });
    await storage.putSized(key, { contentType: `image/${extension}`, size });
    return key;
  };

  const registerBody = (overrides = {}) => ({
    fullName: "Media Registered",
    fatherName: "Media Father",
    phone: `9${randomDigits(9)}`,
    dob: "1995-02-03",
    bloodGroup: "O+",
    gender: "Male",
    aadhar: randomDigits(12),
    occupation: "Teacher",
    address: "12 Test Street",
    gymPlan: "3 Months",
    trainingType: "Weight Loss",
    ...overrides,
  });

  let memberSeq = 0;
  const createMember = async (overrides = {}) => {
    memberSeq += 1;
    const stamp = Date.now().toString().slice(-6);
    return Member.create({
      branchId: branch._id,
      gymId: Number(`${stamp}${randomDigits(4)}`),
      memberCode: `MP${stamp}${memberSeq}`,
      fullName: "Photo Member",
      fatherName: "Photo Father",
      dob: new Date("1994-05-05"),
      bloodGroup: "B+",
      gender: "Male",
      address: "9 Member Street",
      aadhar: randomDigits(12),
      occupation: "Trainer",
      phone: `8${randomDigits(9)}`,
      gymPlan: "1 Month",
      trainingType: "Weight Loss",
      paymentStatus: "not_paid",
      status: "active",
      version: 0,
      photoUrl: "/uploads/legacy-member.jpg",
      ...overrides,
    });
  };

  const callController = async (handler, req) => {
    const res = makeRes();
    let failure = null;
    await handler(req, res, (err) => {
      if (err) failure = err;
    });
    if (failure && res.statusCode === 200) {
      errorHandler(failure, req, res, () => {});
    }
    return res;
  };

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
    } catch (err) {
      this.skip();
    }

    config.jwt.accessSecret = "test-access-secret";
    branch = await seedTestBranch();
    otherBranch = await seedSecondBranch();

    await Admin.deleteMany({ username: { $regex: /^memphoto_/ } });
    superadmin = await makeAdmin("superadmin", "all");
    saSession = await makeSession(superadmin._id);
    saToken = signAccess(superadmin, saSession.sessionId);
  });

  after(async function () {
    resetMediaForTests();
    if (mongoose.connection.readyState === 1) {
      // The save hook appends the father's initial ("Photo Member P."), so
      // match on prefix rather than the exact submitted name.
      await Member.deleteMany({
        fullName: { $regex: /^(Media Registered|Photo Member)/ },
      }).catch(() => {});
      await Admin.deleteMany({ username: { $regex: /^memphoto_/ } }).catch(() => {});
      await AdminSession.deleteMany({ adminId: superadmin?._id }).catch(() => {});
    }
  });

  beforeEach(function () {
    storage = createMemoryStorage();
    configureMediaForTests({ enabled: true, storage });
  });

  afterEach(function () {
    resetMediaForTests();
  });

  /* ============================================================
     REGISTER
     ============================================================ */
  describe("POST /api/members/register with photoKey", () => {
    it("attaches an uploaded object and returns its delivery URL", async () => {
      const photoKey = await uploadPhoto();
      const phone = `9${randomDigits(9)}`;

      const res = await runMemberRoute("post", "/register", {
        body: registerBody({ phone, photoKey }),
      });

      expect(res.statusCode).to.equal(201);
      const body = serialize(res);
      expect(body.data.photoKey).to.equal(photoKey);
      expect(body.data.photoUrl).to.equal(deliveryUrl(photoKey));

      const stored = await Member.findOne({ phone }).lean();
      expect(stored).to.be.an("object");
      expect(stored.photoKey).to.equal(photoKey);
      expect(stored.photoUrl).to.equal(null);
    });

    it("rejects a key that was never uploaded (member is NOT created)", async () => {
      const { key } = await presignPhoto({ branchCode: branch.code }); // no put()
      const phone = `9${randomDigits(9)}`;

      const res = await runMemberRoute("post", "/register", {
        body: registerBody({ phone, photoKey: key }),
      });

      expect(res.statusCode).to.equal(422);
      expect(res.body.errorCode).to.equal("MEDIA_OBJECT_MISSING");

      const stored = await Member.findOne({ phone });
      expect(stored).to.equal(null);
    });

    it("keeps registration working with no photo at all", async () => {
      const phone = `9${randomDigits(9)}`;

      const res = await runMemberRoute("post", "/register", { body: registerBody({ phone }) });

      expect(res.statusCode).to.equal(201);
      const body = serialize(res);
      expect(body.data.photoKey).to.equal(null);
      expect(body.data.photoUrl).to.equal(null);
    });

    it("refuses a multipart photo file while the media pipeline is ON", async () => {
      const res = await callController(memberController.registerMember, adminReq({
        branchId: branch._id,
        admin: { id: superadmin._id, username: superadmin.username, role: "superadmin", scope: "all", branchId: branch._id },
        body: registerBody(),
        file: { filename: "123-smuggled.jpg" },
      }));

      expect(res.statusCode).to.equal(400);
      expect(res.body.message).to.match(/media upload flow/);
    });

    it("legacy mode: a multipart photo file still stores /uploads when disabled", async () => {
      configureMediaForTests({ enabled: false, storage });
      const phone = `9${randomDigits(9)}`;

      const res = await callController(memberController.registerMember, adminReq({
        branchId: branch._id,
        admin: { id: superadmin._id, username: superadmin.username, role: "superadmin", scope: "all", branchId: branch._id },
        body: registerBody({ phone }),
        file: { filename: "1700000000-legacy.jpg" },
      }));

      expect(res.statusCode).to.equal(201);
      const body = serialize(res);
      expect(body.data.photoUrl).to.equal("/uploads/1700000000-legacy.jpg");
      expect(body.data.photoKey).to.equal(null);
    });
  });

  /* ============================================================
     UPDATE
     ============================================================ */
  describe("PUT /api/members/:gymId with photoKey", () => {
    it("replaces the active photo and RETAINS the previous object", async () => {
      const oldKey = await uploadPhoto();
      const member = await createMember({ photoKey: oldKey, previousPhotos: [] });
      const newKey = await uploadPhoto({ memberId: member._id.toString() });

      const res = await runMemberRoute("put", "/:gymId", {
        params: { gymId: String(member.gymId) },
        body: { version: member.version, photoKey: newKey, occupation: "Updated by test" },
      });

      expect(res.statusCode).to.equal(200);
      const body = serialize(res);
      expect(body.data.photoKey).to.equal(newKey);
      expect(body.data.photoUrl).to.equal(deliveryUrl(newKey));
      expect(body.data.version).to.equal(member.version + 1);

      const stored = await Member.findById(member._id).lean();
      expect(stored.photoKey).to.equal(newKey);
      expect(stored.previousPhotos).to.have.length(1);
      expect(stored.previousPhotos[0].key).to.equal(oldKey);
      expect(stored.previousPhotos[0].retiredAt).to.be.an("date");
      // The replaced object is never deleted at write time (retention window).
      expect(await storage.head(oldKey)).to.not.equal(null);
    });

    it("refuses another member's photo key", async () => {
      const owner = await createMember();
      const stranger = await createMember();
      const key = await uploadPhoto({ memberId: stranger._id.toString() });

      const res = await runMemberRoute("put", "/:gymId", {
        params: { gymId: String(owner.gymId) },
        body: { version: owner.version, photoKey: key },
      });

      expect(res.statusCode).to.equal(403);
      expect(res.body.errorCode).to.equal("MEDIA_KEY_FORBIDDEN");

      const stored = await Member.findById(owner._id).lean();
      expect(stored.photoKey).to.not.equal(key);
    });

    it("rejects a photo key from another tenant", async () => {
      const member = await createMember();
      const foreignKey = `tenants/${otherBranch.code}/members/pending/x-${crypto
        .randomBytes(6)
        .toString("hex")}/photo-1-${crypto.randomBytes(6).toString("hex")}.webp`;
      await storage.put(foreignKey, { contentType: "image/webp", body: "bytes" });

      const res = await runMemberRoute("put", "/:gymId", {
        params: { gymId: String(member.gymId) },
        body: { version: member.version, photoKey: foreignKey },
      });

      expect(res.statusCode).to.equal(403);
      expect(res.body.errorCode).to.equal("MEDIA_KEY_FORBIDDEN");
    });

    it("still updates profile fields without touching the photo", async () => {
      const member = await createMember({ photoKey: null });
      const res = await runMemberRoute("put", "/:gymId", {
        params: { gymId: String(member.gymId) },
        body: { version: member.version, occupation: "Accountant" },
      });

      expect(res.statusCode).to.equal(200);
      const stored = await Member.findById(member._id).lean();
      expect(stored.occupation).to.equal("Accountant");
      expect(stored.photoKey).to.equal(null);
      expect(stored.photoUrl).to.equal("/uploads/legacy-member.jpg");
    });
  });

  /* ============================================================
     PUT /api/members/:gymId/photo
     ============================================================ */
  describe("PUT /api/members/:gymId/photo", () => {
    it("attaches an uploaded photo to an existing member", async () => {
      const member = await createMember({ photoKey: null, photoUrl: null });
      const key = await uploadPhoto({ memberId: member._id.toString() });

      const res = await runMemberRoute("put", "/:gymId/photo", {
        params: { gymId: String(member.gymId) },
        body: { photoKey: key, version: member.version },
      });

      expect(res.statusCode).to.equal(200);
      const body = serialize(res);
      expect(body.data.photoKey).to.equal(key);
      expect(body.data.photoUrl).to.equal(deliveryUrl(key));

      const stored = await Member.findById(member._id).lean();
      expect(stored.photoKey).to.equal(key);
    });

    it("returns 409 when another admin edited the member meanwhile", async () => {
      const member = await createMember();
      const key = await uploadPhoto({ memberId: member._id.toString() });

      const res = await runMemberRoute("put", "/:gymId/photo", {
        params: { gymId: String(member.gymId) },
        body: { photoKey: key, version: member.version + 5 },
      });

      expect(res.statusCode).to.equal(409);
      expect(res.body.errorCode).to.equal("CONFLICT");
    });

    it("returns 422 when the object was never uploaded", async () => {
      const member = await createMember({ photoKey: null });
      const { key } = await presignPhoto({
        branchCode: branch.code,
        memberId: member._id.toString(),
      });

      const res = await runMemberRoute("put", "/:gymId/photo", {
        params: { gymId: String(member.gymId) },
        body: { photoKey: key, version: member.version },
      });

      expect(res.statusCode).to.equal(422);
      expect(res.body.errorCode).to.equal("MEDIA_OBJECT_MISSING");
    });

    it("returns 503 when the media pipeline is disabled", async () => {
      configureMediaForTests({ enabled: false, storage });
      const member = await createMember({ photoKey: null });

      const res = await runMemberRoute("put", "/:gymId/photo", {
        params: { gymId: String(member.gymId) },
        body: { photoKey: `tenants/${branch.code}/members/${member._id}/photo-1-abc123def456.webp`, version: member.version },
      });

      expect(res.statusCode).to.equal(503);
      expect(res.body.errorCode).to.equal("MEDIA_DISABLED");
    });

    it("requires photoKey", async () => {
      const member = await createMember();

      const res = await runMemberRoute("put", "/:gymId/photo", {
        params: { gymId: String(member.gymId) },
        body: { version: member.version },
      });

      expect(res.statusCode).to.equal(400);
      expect(res.body.errorCode).to.equal("VALIDATION_ERROR");
    });
  });

  /* ============================================================
     READ PATHS
     ============================================================ */
  describe("photo delivery in read paths", () => {
    it("serializes member.photoUrl as the delivery URL when photoKey exists", async () => {
      const key = await uploadPhoto();
      const member = await createMember({ photoKey: key });

      const json = member.toJSON();
      expect(json.photoUrl).to.equal(deliveryUrl(key));

      const res = await runMemberRoute("get", "/:gymId", {
        method: "GET",
        params: { gymId: String(member.gymId) },
      });

      expect(res.statusCode).to.equal(200);
      expect(serialize(res).data.photoUrl).to.equal(deliveryUrl(key));
    });

    it("keeps the legacy value for members without a media key", async () => {
      const member = await createMember({ photoKey: null });

      const json = member.toJSON();
      expect(json.photoUrl).to.equal("/uploads/legacy-member.jpg");

      const res = await runMemberRoute("get", "/:gymId", {
        method: "GET",
        params: { gymId: String(member.gymId) },
      });

      expect(res.statusCode).to.equal(200);
      expect(serialize(res).data.photoUrl).to.equal("/uploads/legacy-member.jpg");
    });

    it("punch responses resolve the media key (lean member objects)", () => {
      const key = `tenants/${branch.code}/members/64b0f0a1a1a1a1a1a1a1a1a1/photo-2-abc123def456.webp`;
      const attendance = {
        _id: "att1",
        state: "inside",
        checkInTime: new Date(),
        checkOutTime: null,
        durationMin: null,
      };
      const base = {
        _id: "m1",
        gymId: 101,
        fullName: "Punch Member",
        gymPlan: "3 Months",
        validityEnd: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      };

      const withKey = buildPunchResponse({
        attendance,
        member: { ...base, photoKey: key, photoUrl: "/uploads/old.jpg" },
        isCheckOut: false,
        isLate: false,
        daysLeft: 5,
      });
      expect(withKey.member.photoUrl).to.equal(deliveryUrl(key));

      const legacy = buildPunchResponse({
        attendance,
        member: { ...base, photoKey: null, photoUrl: "/uploads/old.jpg" },
        isCheckOut: false,
        isLate: false,
        daysLeft: 5,
      });
      expect(legacy.member.photoUrl).to.equal("/uploads/old.jpg");

      const missing = buildPunchResponse({
        attendance,
        member: { ...base, photoKey: null, photoUrl: null },
        isCheckOut: false,
        isLate: false,
        daysLeft: 5,
      });
      expect(missing.member.photoUrl).to.equal(null);
    });
  });
});
