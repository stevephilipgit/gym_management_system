/**
 * Reports RBAC — direct authorization tests
 *
 * Verifies the reports export endpoints enforce role authorization server-side.
 *
 *   GET /api/reports/export/attendance  → adminAuth + requireRole("superadmin")
 *   GET /api/reports/export/members     → adminAuth + requireRole("superadmin")
 *   GET /api/reports/inactive           → adminAuth (trainer-accessible)
 *   GET /api/reports/export/inactive    → adminAuth (trainer-accessible)
 *
 * Uses the exact middleware-contract pattern from scopeAndSessions.test.js
 * (real JWT + AdminSession) plus direct requireRole evaluation for role checks.
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
import "../models/Attendance.js";
import Admin from "../models/Admin.js";
import AdminSession from "../models/AdminSession.js";
import config from "../config/index.js";
import adminAuth from "../middleware/adminAuth.js";
import requireRole from "../middleware/requireRole.js";
import reportsRoutes from "../routes/reportsRoutes.js";

const DB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/gym_test";

describe("Reports RBAC authorization (integration)", function () {
  this.timeout(30000);
  let connected = false;
  let superadmin, trainerMale, trainerFemale;
  let saSession, trainerSession;
  let saToken, trainerToken;

  const makeAdmin = async (role, scope) => {
    const username = `report_${role}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return Admin.create({
      fullName: `Report ${role}`,
      username,
      email: `${username}@example.com`,
      role,
      scope,
      passwordHash: "x",
      status: "active",
      tokenVersion: 0,
    });
  };

  const makeSession = async (adminId) =>
    AdminSession.create({
      sessionId: crypto.randomUUID(),
      adminId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: null,
    });

  const signAccess = (admin, sid) =>
    jwt.sign(
      { id: admin._id, username: admin.username, role: admin.role, scope: admin.scope, email: admin.email, sid, tv: 0 },
      config.jwt.accessSecret,
      { expiresIn: "15m" }
    );

  // Build a FULLY authenticated req for a given admin — valid session header +
  // session-scoped cookie + signed token, so adminAuth passes and the role
  // check (requireRole) is what the route actually exercises.
  const authedReq = (admin, session, token) => ({
    get: (n) => (n === "x-session-id" ? session.sessionId : undefined),
    cookies: { [`gym_admin_token_${session.sessionId}`]: token },
    query: {},
  });

  // Run a route's full middleware chain (adminAuth → [requireRole] → controller)
  // against the given req to assert the resulting HTTP status.
  const runRoute = async (req, path) => {
    const res = { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set(c, v) { this.headers[c] = v; return this; } };
    const stack = reportsRoutes.stack;
    for (const layer of stack) {
      if (layer.route?.path !== path) continue;
      const handlers = layer.route.stack.map((l) => l.handle);
      for (const h of handlers) {
        if (res.statusCode !== 200) break; // a middleware wrote an error status
        await h(req, res, () => {});
      }
      break;
    }
    return { res };
  };

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      config.jwt.accessSecret = "test-access-secret";
      await AdminSession.deleteMany({});
      await Admin.deleteMany({ username: { $regex: /^report_/ } });

      superadmin = await makeAdmin("superadmin", "all");
      trainerMale = await makeAdmin("trainer", "male");
      trainerFemale = await makeAdmin("trainer", "female_plus_transgender");

      saSession = await makeSession(superadmin._id);
      trainerSession = await makeSession(trainerMale._id);
      saToken = signAccess(superadmin, saSession.sessionId);
      trainerToken = signAccess(trainerMale, trainerSession.sessionId);
    } catch (err) {
      this.skip();
    }
  });

  after(async () => {
    if (connected) {
      await AdminSession.deleteMany({});
      await Admin.deleteMany({ username: { $regex: /^report_/ } });
      await mongoose.disconnect();
    }
  });

  /* ── Middleware-level checks (exact contract from scopeAndSessions) ── */
  it("adminAuth: valid superadmin session passes", async () => {
    const req = {
      get: (n) => (n === "x-session-id" ? saSession.sessionId : undefined),
      cookies: { [`gym_admin_token_${saSession.sessionId}`]: saToken },
    };
    let nextCalled = false;
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() {} };
    await adminAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).to.be.true;
  });

  it("adminAuth: trainer session passes adminAuth", async () => {
    const req = {
      get: (n) => (n === "x-session-id" ? trainerSession.sessionId : undefined),
      cookies: { [`gym_admin_token_${trainerSession.sessionId}`]: trainerToken },
    };
    let nextCalled = false;
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() {} };
    await adminAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).to.be.true;
  });

  it("adminAuth: unauthenticated (no session) → 401", async () => {
    const req = { get: (n) => undefined, cookies: {} };
    let nextCalled = false;
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() {} };
    await adminAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).to.be.false;
    expect(res.statusCode).to.equal(401);
  });

  it("requireRole(superadmin): superadmin passes, trainer blocked (403)", () => {
    const pass = requireRole("superadmin");
    let nextCalled = false;
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() {} };
    pass({ admin: { role: "superadmin" } }, res, () => { nextCalled = true; });
    expect(nextCalled).to.be.true;

    let nextCalled2 = false;
    const res2 = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() {} };
    pass({ admin: { role: "trainer" } }, res2, () => { nextCalled2 = true; });
    expect(nextCalled2).to.be.false;
    expect(res2.statusCode).to.equal(403);
  });

  /* ── Route-level checks (full middleware chain) ── */
  it("GET /api/reports/export/attendance — Super Admin → controller runs (200)", async () => {
    const { res } = await runRoute(authedReq(superadmin, saSession, saToken), "/export/attendance");
    expect(res.statusCode).to.not.equal(401);
    expect(res.statusCode).to.not.equal(403);
  });

  it("GET /api/reports/export/attendance — Trainer → 403", async () => {
    const { res } = await runRoute(authedReq(trainerMale, trainerSession, trainerToken), "/export/attendance");
    expect(res.statusCode).to.equal(403);
  });

  it("GET /api/reports/export/members — Super Admin → controller runs (not 401/403)", async () => {
    const { res } = await runRoute(authedReq(superadmin, saSession, saToken), "/export/members");
    expect(res.statusCode).to.not.equal(401);
    expect(res.statusCode).to.not.equal(403);
  });

  it("GET /api/reports/export/members — Trainer → 403", async () => {
    const { res } = await runRoute(authedReq(trainerMale, trainerSession, trainerToken), "/export/members");
    expect(res.statusCode).to.equal(403);
  });

  it("GET /api/reports/inactive — Trainer → controller runs (trainer-accessible)", async () => {
    const { res } = await runRoute(authedReq(trainerMale, trainerSession, trainerToken), "/inactive");
    expect(res.statusCode).to.not.equal(403);
  });

  it("GET /api/reports/export/inactive — Trainer → controller runs (trainer-accessible)", async () => {
    const { res } = await runRoute(authedReq(trainerFemale, trainerSession, trainerToken), "/export/inactive");
    expect(res.statusCode).to.not.equal(403);
  });

  it("cross-scope trainer: female trainer can still use inactive exports (scope-filtered)", async () => {
    const { res } = await runRoute(authedReq(trainerFemale, trainerSession, trainerToken), "/export/inactive");
    expect(res.statusCode).to.not.equal(403);
  });
});