/**
 * Member Photo Media Pipeline — Phase 2 (integration).
 *
 * Covers the presign + media-session HTTP chains end to end against the real
 * middlewares (adminAuth → branchContext → validateSchema → controller):
 *   PRESIGN  — auth required, branch scoping, gender scope, pending keys for
 *              registration, disabled pipeline, object-key shape
 *   SESSION  — edge cookie issued for the caller's branch, verifyable with the
 *              shared token verifier the Worker uses
 *
 * The storage layer is the in-memory adapter (no storage credentials required).
 * Requires MongoDB (MONGO_URI or localhost:27017/gym_test) and SKIPS when it
 * is unreachable, matching the rest of the integration suites.
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
import Admin from "../models/Admin.js";
import AdminSession from "../models/AdminSession.js";
import Member from "../models/Member.js";
import config from "../config/index.js";
import { errorHandler } from "../core/errorHandler.js";
import mediaRoutes from "../routes/mediaRoutes.js";
import mediaController from "../controllers/mediaController.js";
import {
  configureMediaForTests,
  isMediaEnabled,
  resetMediaForTests,
} from "../media/mediaService.js";
import { createMemoryStorage } from "../media/storage.js";
import { parsePhotoKey } from "../media/objectKeys.js";
import { verifyMediaToken } from "../media/token.js";
import { MEDIA_CONFIG } from "../config/mediaConfig.js";
import { seedTestBranch, seedSecondBranch } from "./utils/branchFixture.js";

const DB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/gym_test";

describe("Media presign + session (integration)", function () {
  this.timeout(30000);

  let branch;
  let otherBranch;
  let superadmin;
  let trainerMale;
  let saSession;
  let trainerSession;
  let saToken;
  let trainerToken;
  let memberMale;
  let memberFemale;
  let foreignMember;
  let storage;

  const makeAdmin = async (role, scope) => {
    const username = `media_${role}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return Admin.create({
      fullName: `Media ${role}`,
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

  const authedReq = (session, token, overrides = {}) => ({
    ip: "127.0.0.1",
    method: "POST",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    // express-rate-limit reads `app.get("trust proxy ...")` while building its
    // key; the mock needs the same shape a real Express req has.
    app: { get: () => undefined },
    get: (name) => (name === "x-session-id" ? session.sessionId : undefined),
    cookies: { [`gym_admin_token_${session.sessionId}`]: token },
    body: {},
    query: {},
    ...overrides,
  });

  const makeRes = () => ({
    statusCode: 200,
    body: null,
    headers: {},
    cookieJar: {},
    cleared: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    cookie(name, value, options) {
      this.cookieJar[name] = { value, options };
      return this;
    },
    clearCookie(name) {
      this.cleared.push(name);
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    // Node/Express response header surface — required by express-rate-limit
    // (sets X-RateLimit-* / RateLimit-* on every response).
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[name];
    },
    removeHeader(name) {
      delete this.headers[name];
      return this;
    },
  });

  /** Run one media route's full middleware chain against a mock req. */
  const runRoute = async (method, path, req) => {
    const res = makeRes();
    let failure = null;

    for (const layer of mediaRoutes.stack) {
      if (!layer.route || layer.route.path !== path) continue;
      if (!layer.route.stack.some((l) => l.method === method)) continue;

      for (const handler of layer.route.stack) {
        if (handler.method !== method) continue;
        if (res.statusCode !== 200) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          const done = (err) => {
            if (err && !failure) failure = err;
            resolve();
          };
          const outcome = handler.handle(req, res, done);
          if (outcome && typeof outcome.then === "function") {
            outcome.then(() => resolve(), (err) => {
              if (!failure) failure = err;
              resolve();
            });
          }
        });
        // Express stops the chain the moment a middleware passes an error on.
        if (failure) break;
      }
      break;
    }

    // Express routes thrown AppErrors to the global error handler; mirror that
    // here so controller rejections become real HTTP responses.
    if (failure && res.statusCode === 200) {
      if (process.env.MEDIA_DEBUG) {
        // eslint-disable-next-line no-console
        console.error("[media-test] failure:", failure?.message, failure?.statusCode, failure?.stack?.split("\n")[1]);
      }
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

    await Admin.deleteMany({ username: { $regex: /^media_/ } });
    await Member.deleteMany({ memberCode: { $regex: /^(MM|MF|MFN)\d/ } }).catch(() => {});

    superadmin = await makeAdmin("superadmin", "all");
    trainerMale = await makeAdmin("trainer", "male");
    saSession = await makeSession(superadmin._id);
    trainerSession = await makeSession(trainerMale._id);
    saToken = signAccess(superadmin, saSession.sessionId);
    trainerToken = signAccess(trainerMale, trainerSession.sessionId);

    memberMale = await makeMember("MM", "Male", branch._id);
    memberFemale = await makeMember("MF", "Female", branch._id);
    foreignMember = await makeMember("MFN", "Male", otherBranch._id);
  });

  after(async function () {
    resetMediaForTests();
    if (mongoose.connection.readyState === 1) {
      await Member.deleteMany({ memberCode: { $regex: /^(MM|MF|MFN)\d/ } }).catch(() => {});
      await Admin.deleteMany({ username: { $regex: /^media_/ } }).catch(() => {});
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

  async function makeMember(prefix, gender, branchId) {
    const stamp = Date.now().toString().slice(-6);
    const n = Math.floor(Math.random() * 9000) + 1000;
    return Member.create({
      branchId,
      gymId: Number(`${stamp}${n}`),
      memberCode: `${prefix}${n}`,
      fullName: "Media Test Member",
      fatherName: "Media Father",
      dob: new Date("1995-01-01"),
      bloodGroup: "O+",
      gender,
      address: "1 Test Street",
      aadhar: `${Math.floor(Math.random() * 9e11) + 1e11}`,
      occupation: "Trainer",
      phone: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`,
      gymPlan: "3 months",
      trainingType: "Weight Loss",
      paymentStatus: "not_paid",
      photoUrl: "/uploads/legacy-fixture.jpg",
    });
  }

  /* ============================================================
     PRESIGN
     ============================================================ */
  describe("POST /api/media/presign", () => {
    it("requires an authenticated admin session", async () => {
      const req = authedReq(saSession, "not-a-real-token", { body: { extension: "webp" } });
      const res = await runRoute("post", "/presign", req);

      expect(res.statusCode).to.equal(401);
      expect(isMediaEnabled()).to.equal(true);
    });

    it("issues a tenant-scoped, versioned key for an existing member", async () => {
      const res = await runRoute(
        "post",
        "/presign",
        authedReq(saSession, saToken, {
          body: { memberId: memberMale._id.toString(), extension: "webp" },
        })
      );

      expect(res.statusCode).to.equal(201);
      const data = res.body.data;
      expect(data.method).to.equal("PUT");
      expect(data.headers).to.deep.equal({ "Content-Type": "image/webp" });
      expect(data.maxBytes).to.equal(300 * 1024);
      expect(data.url).to.be.a("string").and.not.equal("");

      const parsed = parsePhotoKey(data.key);
      expect(parsed).to.be.an("object");
      expect(parsed.branchCode).to.equal(branch.code);
      expect(parsed.scope).to.equal("member");
      expect(parsed.memberId).to.equal(memberMale._id.toString());
      expect(parsed.version).to.equal(1);
    });

    it("issues an in-flight pending key when no member exists yet", async () => {
      const res = await runRoute(
        "post",
        "/presign",
        authedReq(saSession, saToken, { body: { extension: "jpeg" } })
      );

      expect(res.statusCode).to.equal(201);
      expect(parsePhotoKey(res.body.data.key).scope).to.equal("pending");
      expect(res.body.data.headers["Content-Type"]).to.equal("image/jpeg");
    });

    it("hides members of another branch (404, not 403)", async () => {
      const res = await runRoute(
        "post",
        "/presign",
        authedReq(saSession, saToken, {
          body: { memberId: foreignMember._id.toString(), extension: "webp" },
        })
      );

      expect(res.statusCode).to.equal(404);
      expect(res.body.errorCode).to.equal("NOT_FOUND");
    });

    it("blocks a gender-scoped trainer from an out-of-scope member", async () => {
      const res = await runRoute(
        "post",
        "/presign",
        authedReq(trainerSession, trainerToken, {
          body: { memberId: memberFemale._id.toString(), extension: "webp" },
        })
      );

      expect(res.statusCode).to.equal(403);
      expect(res.body.errorCode).to.equal("FORBIDDEN");
    });

    it("allows a gender-scoped trainer for an in-scope member", async () => {
      const res = await runRoute(
        "post",
        "/presign",
        authedReq(trainerSession, trainerToken, {
          body: { memberId: memberMale._id.toString(), extension: "webp" },
        })
      );

      expect(res.statusCode).to.equal(201);
      expect(parsePhotoKey(res.body.data.key).branchCode).to.equal(branch.code);
    });

    it("rejects an unsupported extension before signing anything", async () => {
      const res = await runRoute(
        "post",
        "/presign",
        authedReq(saSession, saToken, { body: { extension: "gif" } })
      );

      expect(res.statusCode).to.equal(400);
      expect(res.body.errorCode).to.equal("VALIDATION_ERROR");
      expect(storage.objects.size).to.equal(0);
    });

    it("returns 503 MEDIA_DISABLED when the pipeline is off", async () => {
      configureMediaForTests({ enabled: false, storage });

      const res = await runRoute(
        "post",
        "/presign",
        authedReq(saSession, saToken, { body: { extension: "webp" } })
      );

      expect(res.statusCode).to.equal(503);
      expect(res.body.errorCode).to.equal("MEDIA_DISABLED");
    });
  });

  /* ============================================================
     MEDIA SESSION (edge cookie)
     ============================================================ */
  describe("POST /api/media/session", () => {
    it("sets an HttpOnly cookie the Worker can verify for this branch", async () => {
      const res = await runRoute("post", "/session", authedReq(saSession, saToken, {}));

      expect(res.statusCode).to.equal(200);
      expect(res.body.data.enabled).to.equal(true);
      expect(res.body.data.branchCode).to.equal(branch.code);

      const cookie = res.cookieJar[MEDIA_CONFIG.token.cookieName];
      expect(cookie, "media cookie was not set").to.be.an("object");
      expect(cookie.options.httpOnly).to.equal(true);
      expect(cookie.options.path).to.equal("/");

      const payload = await verifyMediaToken(cookie.value, {
        secret: MEDIA_CONFIG.token.secret,
      });
      expect(payload).to.be.an("object");
      expect(payload.branchCode).to.equal(branch.code);
      expect(payload.subject).to.equal(`admin:${String(superadmin._id)}`);
    });

    it("does not fail when the pipeline is disabled (legacy mode)", async () => {
      configureMediaForTests({ enabled: false, storage });

      const res = await runRoute("post", "/session", authedReq(saSession, saToken, {}));

      expect(res.statusCode).to.equal(200);
      expect(res.body.data.enabled).to.equal(false);
      expect(res.cookieJar[MEDIA_CONFIG.token.cookieName]).to.equal(undefined);
    });

    it("rejects unauthenticated callers", async () => {
      const res = await runRoute(
        "post",
        "/session",
        authedReq(saSession, "bad-token", {})
      );

      expect(res.statusCode).to.equal(401);
    });
  });

  /* ============================================================
     PUBLIC CONFIG + SESSION CLEAR
     ============================================================ */
  describe("GET /api/media/config and DELETE /api/media/session", () => {
    it("exposes the delivery base and limits without leaking secrets", async () => {
      const res = await runRoute(
        "get",
        "/config",
        authedReq(saSession, saToken, { method: "GET" })
      );

      expect(res.statusCode).to.equal(200);
      expect(res.body.data.enabled).to.equal(true);
      expect(res.body.data.deliveryBaseUrl).to.be.a("string");
      expect(res.body.data).to.not.have.property("storage");
      expect(JSON.stringify(res.body)).to.not.include("SECRET");
    });

    it("clears the media cookie on demand", async () => {
      const res = await runRoute(
        "delete",
        "/session",
        authedReq(saSession, saToken, { method: "DELETE" })
      );

      expect(res.statusCode).to.equal(200);
      expect(res.cleared).to.include(MEDIA_CONFIG.token.cookieName);
    });
  });

  /* ============================================================
     KIOSK SESSION (controller-level: kioskAuth itself is covered by the
     kiosk suites, this exercises the media session it feeds)
     ============================================================ */
  describe("kiosk media session", () => {
    const kioskReq = () => ({
      kiosk: { kioskId: "kiosk-media-1", branchId: branch._id, scope: "male" },
      cookies: {},
      res: null,
    });

    it("binds the token to the device's branch with a kiosk subject", async () => {
      const req = kioskReq();
      const res = makeRes();
      let failure = null;

      await mediaController.createKioskMediaSession(req, res, (err) => {
        if (err) failure = err;
      });
      if (failure) errorHandler(failure, req, res, () => {});

      expect(res.statusCode).to.equal(200);
      expect(res.body.data.enabled).to.equal(true);
      expect(res.body.data.branchCode).to.equal(branch.code);

      const payload = await verifyMediaToken(res.cookieJar[MEDIA_CONFIG.token.cookieName].value, {
        secret: MEDIA_CONFIG.token.secret,
      });
      expect(payload.branchCode).to.equal(branch.code);
      expect(payload.subject).to.equal("kiosk:kiosk-media-1");
    });
  });
});
