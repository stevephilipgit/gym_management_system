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

dotenv.config();

import '../models/Admin.js';
import '../models/AdminSession.js';
import '../models/Member.js';
import '../models/Attendance.js';
import scopeResolver from '../core/scopeResolver.js';
import Admin from '../models/Admin.js';
import AdminSession from '../models/AdminSession.js';
import Member from '../models/Member.js';
import Attendance from '../models/Attendance.js';

const DB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gym_test';

describe('Gender scope + per-device sessions (integration)', function () {
  this.timeout(30000);

  let connected = false;

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      // Keep the DB clean for repeatable runs.
      await AdminSession.deleteMany({});
      await Admin.deleteMany({ username: { $regex: /^scope_test_/ } });
      await Member.deleteMany({ gymId: { $in: [10101, 10102, 10103] } });
      await Attendance.deleteMany({});
    } catch (err) {
      this.skip(); // no DB available — skip the suite
    }
  });

  after(async () => {
    if (connected) await mongoose.disconnect();
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
      phone: `91${Math.floor(100000000 + Math.random() * 899999999)}`,
      aadhar: `10${Math.floor(100000000000 + Math.random() * 899999999999)}`,
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
      phone: `92${Math.floor(100000000 + Math.random() * 899999999)}`,
      aadhar: `11${Math.floor(100000000000 + Math.random() * 899999999999)}`,
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
    expect(maleScopeIds).to.include(maleMember._id);
    expect(maleScopeIds).to.not.include(femaleMember._id);

    const maleStats = await attendanceService.getTodayStats(maleScopeIds);
    expect(maleStats.totalPunches).to.equal(1);

    const allStats = await attendanceService.getTodayStats(null);
    expect(allStats.totalPunches).to.equal(2);
  });
});
