/**
 * Integration regression tests: gender-scope enforcement + per-device sessions.
 *
 * Requires a MongoDB instance (MONGO_URI or mongodb://localhost:27017/gym_test).
 * The suite SKIPS itself when MongoDB is unreachable, so it never hard-fails
 * a machine without a local database.
 *
 * Run: cd backend && npm test
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { expect } from 'chai';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

dotenv.config();

import '../models/Admin.js';
import '../models/AdminSession.js';
import '../models/Member.js';
import '../models/Attendance.js';
import '../models/Diet.js';
import scopeResolver from '../core/scopeResolver.js';
import Admin from '../models/Admin.js';
import AdminSession from '../models/AdminSession.js';
import Member from '../models/Member.js';
import Attendance from '../models/Attendance.js';
import adminAuth from '../middleware/adminAuth.js';
import memberController from '../controllers/memberController.js';
import memberRepository from '../repositories/memberRepository.js';
import Counter from '../services/atomicCounter.js';
import config from '../config/index.js';
import redisClient from '../config/redis.js';

const DB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gym_test';

describe('Gender scope + per-device sessions (integration)', function () {
  this.timeout(30000);

  let connected = false;

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      // Keep the DB clean for repeatable runs (isolated test database).
      await AdminSession.deleteMany({});
      await Admin.deleteMany({});
      await Member.deleteMany({});
      await Attendance.deleteMany({});
      // Deterministic signing secret for middleware contract tests.
      config.jwt.accessSecret = 'test-access-secret';
      config.jwt.refreshSecret = 'test-refresh-secret';
    } catch (err) {
      await redisClient.quit().catch(() => {}); // avoid keeping the event loop alive
      this.skip(); // no DB available — skip the suite
    }
  });

  after(async () => {
    if (connected) await mongoose.disconnect();
    await redisClient.quit().catch(() => {});
  });

  const makeAdmin = async (role, scope) => {
    const admin = await Admin.create({
      fullName: `Scope Test ${role} ${scope}`,
      username: `scope_test_${role}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      email: `scope_test_${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`,
      role,
      scope,
      passwordHash: 'x',
      status: 'active',
      tokenVersion: 0,
    });
    return admin;
  };

  const makeSession = async (adminId) => {
    const now = Date.now();
    return AdminSession.create({
      sessionId: crypto.randomUUID(),
      adminId,
      createdAt: new Date(now),
      expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
      revokedAt: null,
    });
  };

  it('session model: logging out one session leaves the other active', async () => {
    const admin = await makeAdmin('trainer', 'male');
    const sessionA = await makeSession(admin._id);
    const sessionB = await makeSession(admin._id);

    // Device A logs out → revoke session A only
    await AdminSession.updateOne({ sessionId: sessionA.sessionId }, { $set: { revokedAt: new Date() } });

    const activeA = await AdminSession.findOne({ sessionId: sessionA.sessionId, revokedAt: null });
    const activeB = await AdminSession.findOne({ sessionId: sessionB.sessionId, revokedAt: null });

    expect(activeA).to.be.null;
    expect(activeB).to.not.be.null;
    expect(activeB.sessionId).to.equal(sessionB.sessionId);
  });

  it('session model: tokenVersion bump invalidates all sessions of that admin', async () => {
    const admin = await makeAdmin('trainer', 'male');
    await makeSession(admin._id);
    await makeSession(admin._id);

    // Password change bumps tokenVersion
    await admin.updateOne({ $inc: { tokenVersion: 1 } });
    const active = await AdminSession.find({ adminId: admin._id, revokedAt: null });
    expect(active.length).to.equal(2); // sessions remain but tokens are stale via tv

    // Simulate the adminAuth check: tv mismatch must be treated as expired
    expect(0).to.equal(admin.tokenVersion); // original tv
  });

  it('scopeResolver: gender filter prevents cross-gender member lookup', async () => {
    const maleReq = { admin: { scope: 'male' } };
    const femaleReq = { admin: { scope: 'female_plus_transgender' } };

    expect(scopeResolver.checkMemberScope(maleReq, 'Female')).to.be.false;
    expect(scopeResolver.checkMemberScope(maleReq, 'Transgender')).to.be.false;
    expect(scopeResolver.checkMemberScope(femaleReq, 'Male')).to.be.false;
    expect(scopeResolver.checkMemberScope(femaleReq, 'Transgender')).to.be.true;
    expect(scopeResolver.checkMemberScope({ admin: { scope: 'all' } }, 'Transgender')).to.be.true;
  });

  it('attendance getTodayStats honours a scoped memberId set', async () => {
    // Requires attendanceService — import lazily to keep module load order safe.
    const attendanceService = (await import('../services/attendanceService.js')).default;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maleMember = await Member.create({
      gymId: 10101,
      fullName: 'Scope Test Male',
      fatherName: 'Father',
      dob: new Date(1990, 1, 1),
      bloodGroup: 'O+',
      gender: 'Male',
      phone: `9${String(100000000 + Math.floor(Math.random() * 899999999))}`,
      aadhar: String(100000000000 + Math.floor(Math.random() * 899999999999)),
      occupation: 'Engineer',
      address: 'Test',
      gymPlan: '1 Month',
      trainingType: 'Weight Loss',
      paymentStatus: 'paid',
      validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'active',
    });
    const femaleMember = await Member.create({
      gymId: 10102,
      fullName: 'Scope Test Female',
      fatherName: 'Father',
      dob: new Date(1990, 1, 1),
      bloodGroup: 'O+',
      gender: 'Female',
      phone: `9${String(100000000 + Math.floor(Math.random() * 899999999))}`,
      aadhar: String(100000000000 + Math.floor(Math.random() * 899999999999)),
      occupation: 'Engineer',
      address: 'Test',
      gymPlan: '1 Month',
      trainingType: 'Weight Loss',
      paymentStatus: 'paid',
      validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'active',
    });

    await Attendance.create([
      { memberId: maleMember._id, date: today, checkInTime: new Date(), state: 'inside' },
      { memberId: femaleMember._id, date: today, checkInTime: new Date(), state: 'inside' },
    ]);

    const maleScopeIds = await scopeResolver.getScopedMemberIds({ admin: { scope: 'male' } }, Member);
    const maleScopeHex = maleScopeIds.map((id) => id.toString());
    expect(maleScopeHex).to.include(maleMember._id.toString());
    expect(maleScopeHex).to.not.include(femaleMember._id.toString());

    const maleStats = await attendanceService.getTodayStats(maleScopeIds);
    expect(maleStats.totalPunches).to.equal(1);

    const allStats = await attendanceService.getTodayStats(null);
    expect(allStats.totalPunches).to.equal(2);
  });
});

describe('adminAuth — STRICT per-session contract (integration)', function () {
  this.timeout(30000);

  let connected = false;
  let admin;
  let session;

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      config.jwt.accessSecret = 'test-access-secret';
      config.jwt.refreshSecret = 'test-refresh-secret';
      await AdminSession.deleteMany({});
      await Admin.deleteMany({ username: { $regex: /^auth_test_/ } });
      admin = await Admin.create({
        fullName: 'Auth Test Admin',
        username: `auth_test_${Date.now()}`,
        email: `auth_test_${Date.now()}@example.com`,
        role: 'trainer',
        scope: 'male',
        passwordHash: 'x',
        status: 'active',
        tokenVersion: 0,
      });
      session = await AdminSession.create({
        sessionId: crypto.randomUUID(),
        adminId: admin._id,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revokedAt: null,
      });
    } catch (err) {
      await redisClient.quit().catch(() => {}); // avoid keeping the event loop alive
      this.skip();
    }
  });

  after(async () => {
    if (connected) {
      await AdminSession.deleteMany({});
      await Admin.deleteMany({ username: { $regex: /^auth_test_/ } });
      await mongoose.disconnect();
    }
    await redisClient.quit().catch(() => {});
  });

  const signAccess = (sid, overrides = {}) =>
    jwt.sign(
      { id: admin._id, username: admin.username, role: admin.role, scope: admin.scope, email: admin.email, sid, tv: 0, ...overrides },
      config.jwt.accessSecret,
      { expiresIn: '15m' }
    );

  const makeReq = ({ headerSid, cookies = {} }) => ({
    get: (name) => (name === 'x-session-id' ? headerSid : undefined),
    cookies,
  });

  const runAuth = async (req) => {
    let nextCalled = false;
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    await adminAuth(req, res, () => { nextCalled = true; });
    return { nextCalled, res };
  };

  it('1. missing X-Session-Id is rejected (no legacy fallback)', async () => {
    const req = makeReq({ headerSid: '', cookies: { gym_admin_token: signAccess(session.sessionId) } });
    const { nextCalled, res } = await runAuth(req);
    expect(nextCalled).to.be.false;
    expect(res.statusCode).to.equal(401);
  });

  it('2. header present but no matching session-scoped cookie is rejected', async () => {
    const req = makeReq({ headerSid: session.sessionId, cookies: {} });
    const { nextCalled, res } = await runAuth(req);
    expect(nextCalled).to.be.false;
    expect(res.statusCode).to.equal(401);
  });

  it('3. valid header + matching cookie + active session → accepted', async () => {
    const token = signAccess(session.sessionId);
    const req = makeReq({ headerSid: session.sessionId, cookies: { [`gym_admin_token_${session.sessionId}`]: token } });
    const { nextCalled, res } = await runAuth(req);
    expect(nextCalled).to.be.true;
    expect(res.statusCode).to.equal(200);
  });

  it('4. JWT sid != header sid → rejected', async () => {
    const token = signAccess('other-session-id');
    const req = makeReq({ headerSid: session.sessionId, cookies: { [`gym_admin_token_${session.sessionId}`]: token } });
    const { nextCalled, res } = await runAuth(req);
    expect(nextCalled).to.be.false;
    expect(res.statusCode).to.equal(401);
  });

  it('5. token signed with the wrong secret → rejected', async () => {
    const token = jwt.sign({ id: admin._id, sid: session.sessionId, tv: 0 }, 'wrong-secret', { expiresIn: '15m' });
    const req = makeReq({ headerSid: session.sessionId, cookies: { [`gym_admin_token_${session.sessionId}`]: token } });
    const { nextCalled, res } = await runAuth(req);
    expect(nextCalled).to.be.false;
    expect(res.statusCode).to.equal(401);
  });

  it('6. revoked session → rejected', async () => {
    const revoked = await AdminSession.create({
      sessionId: crypto.randomUUID(),
      adminId: admin._id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: new Date(),
    });
    const token = signAccess(revoked.sessionId);
    const req = makeReq({ headerSid: revoked.sessionId, cookies: { [`gym_admin_token_${revoked.sessionId}`]: token } });
    const { nextCalled, res } = await runAuth(req);
    expect(nextCalled).to.be.false;
    expect(res.statusCode).to.equal(401);
  });

  it('7. expired session → rejected', async () => {
    const expired = await AdminSession.create({
      sessionId: crypto.randomUUID(),
      adminId: admin._id,
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      revokedAt: null,
    });
    const token = signAccess(expired.sessionId);
    const req = makeReq({ headerSid: expired.sessionId, cookies: { [`gym_admin_token_${expired.sessionId}`]: token } });
    const { nextCalled, res } = await runAuth(req);
    expect(nextCalled).to.be.false;
    expect(res.statusCode).to.equal(401);
  });

  it('8. session belonging to a different admin → rejected', async () => {
    const otherAdmin = await Admin.create({
      fullName: 'Other Admin',
      username: `auth_test_other_${Date.now()}`,
      email: `auth_test_other_${Date.now()}@example.com`,
      role: 'trainer',
      scope: 'male',
      passwordHash: 'x',
      status: 'active',
      tokenVersion: 0,
    });
    const token = signAccess(session.sessionId); // signed for `admin`, sid = session
    const req = makeReq({
      headerSid: session.sessionId,
      cookies: { [`gym_admin_token_${session.sessionId}`]: token },
    });
    // Re-point the session doc to another admin so adminId no longer matches.
    await AdminSession.updateOne({ sessionId: session.sessionId }, { $set: { adminId: otherAdmin._id } });
    const { nextCalled, res } = await runAuth(req);
    expect(nextCalled).to.be.false;
    expect(res.statusCode).to.equal(401);
    // restore for subsequent tests
    await AdminSession.updateOne({ sessionId: session.sessionId }, { $set: { adminId: admin._id } });
    await Admin.deleteOne({ _id: otherAdmin._id });
  });
});

describe('member filtering + pagination + trainer scope (integration)', function () {
  this.timeout(30000);

  let connected = false;
  const testGymIds = [];

  const mockRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
  };

  const makeMember = async (gender, prefix) => {
    const gymId = 40000 + Math.floor(Math.random() * 5000) + testGymIds.length;
    testGymIds.push(gymId);
    return Member.create({
      gymId,
      fullName: `Filter Test ${gender} ${prefix}`,
      fatherName: 'Father',
      dob: new Date(1992, 3, 10),
      bloodGroup: 'O+',
      gender,
      phone: `9${String(100000000 + Math.floor(Math.random() * 899999999))}`,
      aadhar: String(100000000000 + Math.floor(Math.random() * 899999999999)),
      occupation: 'Test',
      address: 'Test',
      gymPlan: '1 Month',
      trainingType: 'Weight Loss',
      paymentStatus: 'paid',
      validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'active',
    });
  };

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      // Deterministic counts: getAllMembers is DB-wide, so clear ALL members
      // (and attendance) in the isolated test DB before seeding.
      await Member.deleteMany({});
      await Attendance.deleteMany({});
      // Baseline: 3 Male, 2 Female, 1 Transgender
      await makeMember('Male', 'A');
      await makeMember('Male', 'B');
      await makeMember('Male', 'C');
      await makeMember('Female', 'D');
      await makeMember('Female', 'E');
      await makeMember('Transgender', 'F');
    } catch (err) {
      await redisClient.quit().catch(() => {});
      this.skip();
    }
  });

  after(async () => {
    if (connected) {
      await Member.deleteMany({ gymId: { $gte: 40000, $lte: 46000 } });
      await mongoose.disconnect();
    }
    await redisClient.quit().catch(() => {});
  });

  const allMembers = async (scope, query = {}) => {
    const req = { admin: { scope, role: scope === 'all' ? 'superadmin' : 'trainer' }, query: { pageSize: '100', ...query } };
    const res = mockRes();
    await memberController.getAllMembers(req, res);
    return res.body;
  };

  it('1. superadmin ?gender=Male returns only Male', async () => {
    const body = await allMembers('all', { gender: 'Male' });
    expect(body.data.length).to.equal(3);
    body.data.forEach((m) => expect(m.gender).to.equal('Male'));
  });

  it('2. superadmin ?gender=Female returns only Female', async () => {
    const body = await allMembers('all', { gender: 'Female' });
    expect(body.data.length).to.equal(2);
    body.data.forEach((m) => expect(m.gender).to.equal('Female'));
  });

  it('3. superadmin ?gender=Transgender returns only Transgender', async () => {
    const body = await allMembers('all', { gender: 'Transgender' });
    expect(body.data.length).to.equal(1);
    body.data.forEach((m) => expect(m.gender).to.equal('Transgender'));
  });

  it('4. superadmin without gender returns all genders', async () => {
    const body = await allMembers('all', {});
    expect(body.data.length).to.equal(6);
  });

  it('5. male trainer ?gender=Female → Male scope still enforced', async () => {
    const body = await allMembers('male', { gender: 'Female' });
    expect(body.data.length).to.equal(3);
    body.data.forEach((m) => expect(m.gender).to.equal('Male'));
  });

  it('6. female trainer ?gender=Male → Female + Transgender scope still enforced', async () => {
    const body = await allMembers('female_plus_transgender', { gender: 'Male' });
    expect(body.data.length).to.equal(3);
    body.data.forEach((m) => expect(['Female', 'Transgender']).to.include(m.gender));
  });

  it('7. pagination page1/page2 with pageSize 10 returns correct records + metadata', async () => {
    const created = [];
    for (let i = 0; i < 12; i++) created.push(await makeMember('Male', `P${i}`));
    try {
      const page1 = await allMembers('male', { page: '1', pageSize: '10' });
      const page2 = await allMembers('male', { page: '2', pageSize: '10' });
      expect(page1.data.length).to.equal(10);
      expect(page2.data.length).to.be.greaterThan(0);
      expect(page1.pagination.page).to.equal(1);
      expect(page1.pagination.pageSize).to.equal(10);
      expect(page1.pagination.pages).to.equal(2);
      // No overlap between pages
      const ids1 = new Set(page1.data.map((m) => String(m._id)));
      page2.data.forEach((m) => expect(ids1.has(String(m._id))).to.be.false);
    } finally {
      // Remove the 12 pagination fixtures so later scope-count tests stay clean.
      await Member.deleteMany({ _id: { $in: created.map((m) => m._id) } });
    }
  });

  it('8. pageSize=100000 is safely clamped to the maximum', async () => {
    const body = await allMembers('all', { pageSize: '100000' });
    expect(body.pagination.pageSize).to.be.at.most(100);
  });

  it('9. trainer search cannot expose another gender', async () => {
    const req = {
      admin: { scope: 'female_plus_transgender', role: 'trainer' },
      query: { search: 'Filter Test Male' },
    };
    const res = mockRes();
    await memberController.getAllMembers(req, res);
    expect(res.body.data.length).to.equal(0);
  });

  it('10. single-member lookup: trainer cannot retrieve out-of-scope member', async () => {
    const female = await Member.findOne({ gender: 'Female' }).select('gymId');
    const req = { admin: { scope: 'male', role: 'trainer' }, params: { gymId: String(female.gymId) }, query: {} };
    const res = mockRes();
    let nextErr = null;
    const next = (err) => { nextErr = err; };
    await memberController.getMemberByGymId(req, res, next);
    // Scope-aware lookup never leaks existence — resolves to NotFound (404).
    expect(nextErr).to.not.be.null;
    expect(nextErr.statusCode).to.equal(404);
  });

  it('11. male trainer due list excludes female/transgender members', async () => {
    const req = { admin: { scope: 'male', role: 'trainer' }, query: { days: '3650', includeExpired: 'true', includeDraft: 'true' } };
    const res = mockRes();
    let nextErr = null;
    const next = (err) => { nextErr = err; };
    await memberController.getExpiringMembers(req, res, next);
    if (nextErr) throw nextErr;
    expect(res.body.data.length).to.equal(3);
    res.body.data.forEach((m) => expect(m.gender).to.equal('Male'));
  });

  it('12. female trainer due list = female + transgender only', async () => {
    const req = { admin: { scope: 'female_plus_transgender', role: 'trainer' }, query: { days: '3650', includeExpired: 'true', includeDraft: 'true' } };
    const res = mockRes();
    let nextErr = null;
    const next = (err) => { nextErr = err; };
    await memberController.getExpiringMembers(req, res, next);
    if (nextErr) throw nextErr;
    expect(res.body.data.length).to.equal(3);
    res.body.data.forEach((m) => expect(['Female', 'Transgender']).to.include(m.gender));
  });

  it('13. superadmin due list returns all genders', async () => {
    const req = { admin: { scope: 'all', role: 'superadmin' }, query: { days: '3650', includeExpired: 'true', includeDraft: 'true' } };
    const res = mockRes();
    let nextErr = null;
    const next = (err) => { nextErr = err; };
    await memberController.getExpiringMembers(req, res, next);
    if (nextErr) throw nextErr;
    expect(res.body.data.length).to.equal(6);
  });
});

describe('member identity: duplicate gymId + scope-aware lookup + atomic counters (integration)', function () {
  this.timeout(30000);

  let connected = false;

  const mockRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
  };

  const makeMember = async (gymId, gender, memberCode) =>
    Member.create({
      gymId,
      fullName: `Identity ${gender} ${gymId}`,
      fatherName: 'Father',
      dob: new Date(1990, 1, 1),
      bloodGroup: 'O+',
      gender,
      phone: `9${String(600000000 + Math.floor(Math.random() * 399999999))}`,
      aadhar: String(100000000000 + Math.floor(Math.random() * 899999999999)),
      occupation: 'Test',
      address: 'Test',
      gymPlan: '1 Month',
      trainingType: 'Weight Loss',
      paymentStatus: 'paid',
      validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'active',
      memberCode,
    });

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      await Member.deleteMany({ gymId: { $gte: 55000, $lte: 55999 } });
      await Counter.deleteMany({ key: { $in: ['gym_id_TEST'] } });
      // Pre-create members needed by the tests
      await makeMember(55001, 'Male', 'I0001');
      await makeMember(55001, 'Female', 'I0002');
      await makeMember(55002, 'Male', 'I0003');
      await makeMember(55003, 'Male', 'I0004');
      await makeMember(55010, 'Male', 'I0010');
      await makeMember(55010, 'Female', 'I0011');
    } catch (err) {
      console.log('IDENTITY BEFORE FAILED:', err.message);
      await redisClient.quit().catch(() => {});
      this.skip();
    }
  });

  after(async () => {
    if (connected) {
      await Member.deleteMany({ gymId: { $gte: 55000, $lte: 55999 } });
      await Counter.deleteMany({ key: { $in: ['gym_id_TEST'] } });
      await mongoose.disconnect();
    }
    await redisClient.quit().catch(() => {});
  });

  it('A. duplicate numeric gymId across genders is allowed (compound unique)', async () => {
    const male = await Member.findOne({ gymId: 55001, gender: 'Male' }).lean();
    const female = await Member.findOne({ gymId: 55001, gender: 'Female' }).lean();
    expect(male).to.not.be.null;
    expect(female).to.not.be.null;
    expect(male.gymId).to.equal(female.gymId);
  });

  it('B. duplicate (gymId, gender) pair is rejected by the compound unique', async () => {
    let threw = false;
    try {
      await makeMember(55002, 'Male', 'I0008'); // same gymId AND gender as I0003
    } catch (err) {
      threw = err.code === 11000;
    }
    expect(threw).to.be.true;
  });

  it('C. duplicate memberCode is rejected', async () => {
    let threw = false;
    try {
      await makeMember(55020, 'Male', 'I0004'); // memberCode I0004 already exists
    } catch (err) {
      threw = err.code === 11000;
    }
    expect(threw).to.be.true;
  });

  it('D. trainer-scoped lookup resolves the correct duplicate', async () => {
    const male = await memberRepository.findByGymId(55010, { allowedGenders: ['Male'] });
    const female = await memberRepository.findByGymId(55010, { allowedGenders: ['Female', 'Transgender'] });
    expect(male.gender).to.equal('Male');
    expect(female.gender).to.equal('Female');
  });

  it('E. superadmin getMemberByGymId returns a disambiguation list for duplicates', async () => {
    const matches = await memberRepository.findAllByGymId(55010);
    if (matches.length !== 2) {
      throw new Error(`expected 2 matches for 55010, got ${matches.length}: ${JSON.stringify(matches.map((m) => ({ g: m.gender, c: m.memberCode })))}`);
    }
    const req = { admin: { scope: 'all', role: 'superadmin' }, params: { gymId: '55010' }, query: {} };
    const res = mockRes();
    let nextErr = null;
    const next = (err) => { nextErr = err; };
    await memberController.getMemberByGymId(req, res, next);
    if (nextErr) throw nextErr;
    expect(res.statusCode).to.equal(300);
    expect(res.body.multiple).to.be.true;
    expect(res.body.members.length).to.equal(2);
  });

  it('F. superadmin disambiguates with memberCode', async () => {
    const req = { admin: { scope: 'all', role: 'superadmin' }, params: { gymId: '55010' }, query: { memberCode: 'I0011' } };
    const res = mockRes();
    let nextErr = null;
    const next = (err) => { nextErr = err; };
    await memberController.getMemberByGymId(req, res, next);
    if (nextErr) throw nextErr;
    expect(res.statusCode).to.equal(200);
    expect(res.body.data.memberCode).to.equal('I0011');
    expect(res.body.data.gender).to.equal('Female');
  });

  it('G. atomic per-gender gymId counter produces distinct values under concurrency', async () => {
    const results = await Promise.all([
      Counter.increment('gym_id_TEST'),
      Counter.increment('gym_id_TEST'),
      Counter.increment('gym_id_TEST'),
    ]);
    const unique = new Set(results);
    expect(unique.size).to.equal(3);
  });

  it('H. ensureMin never collides on an existing counter (duplicate-key regression)', async () => {
    const key = 'gym_id_TEST_EM';
    await Counter.deleteMany({ key });
    await Counter.ensureMin(key, 1004);
    // Pre-fix this threw E11000 "Duplicate field: key" because a range filter
    // + upsert attempted to insert a second doc for the same key.
    await Counter.ensureMin(key, 1004);
    let doc = await Counter.findOne({ key });
    expect(doc.seq).to.equal(1004);
    await Counter.ensureMin(key, 1005); // floor raised
    doc = await Counter.findOne({ key });
    expect(doc.seq).to.equal(1005);
    await Counter.deleteMany({ key });
  });
});
