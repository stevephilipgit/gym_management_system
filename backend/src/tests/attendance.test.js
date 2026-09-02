/**
 * Critical Test Cases for Attendance System
 * Tests the core flows: check-in, duplicate block, expiry block, days-left,
 * auto-close, settings, last-attendance tracking, identity, scope isolation
 * and concurrency-safe punch operations.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { expect } from 'chai';

dotenv.config();

// Import models and services
import '../models/Attendance.js';
import '../models/Member.js';
import '../models/SystemSettings.js';
import attendanceService, { AttendanceStateError } from '../services/attendanceService.js';
import systemSettingsService from '../services/systemSettingsService.js';
import scopeResolver from '../core/scopeResolver.js';

const Attendance = mongoose.model('Attendance');
const Member = mongoose.model('Member');
const SystemSettings = mongoose.model('SystemSettings');

const DB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gym_test';

/* ============================================================
   UNIT TESTS — atomic punch race handling (no DB needed)
   ============================================================ */
describe('Attendance atomic primitives (unit)', () => {
  it('AttendanceStateError carries an HTTP status', () => {
    const err = new AttendanceStateError('Already checked in for today', 409);
    expect(err).to.be.instanceOf(Error);
    expect(err.status).to.equal(409);
    expect(err.name).to.equal('AttendanceStateError');
  });

  it('punchIn converts a duplicate-key race into a clean business error (not 500)', async () => {
    const dupError = new Error('duplicate key error');
    dupError.code = 11000;
    dupError.name = 'MongoServerError';
    let original;
    if (typeof Attendance.create === 'function') {
      original = Attendance.create;
    }
    Attendance.create = async () => { throw dupError; };
    try {
      await attendanceService.punchIn('507f1f77bcf86cd799439011', new Date(), { state: 'inside' });
      expect.fail('should have thrown AttendanceStateError');
    } catch (err) {
      expect(err).to.be.instanceOf(AttendanceStateError);
      expect(err.message).to.equal('Already checked in for today');
      expect(err.status).to.equal(409);
    } finally {
      Attendance.create = original;
    }
  });

  it('punchIn propagates non-duplicate errors unchanged', async () => {
    let original;
    if (typeof Attendance.create === 'function') {
      original = Attendance.create;
    }
    Attendance.create = async () => { throw new Error('connection lost'); };
    try {
      await attendanceService.punchIn('507f1f77bcf86cd799439011', new Date(), { state: 'inside' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.not.be.instanceOf(AttendanceStateError);
      expect(err.message).to.equal('connection lost');
    } finally {
      Attendance.create = original;
    }
  });

  it('punchOut converts an already-checked-out state into a clean business error', async () => {
    let original;
    if (typeof Attendance.findOneAndUpdate === 'function') {
      original = Attendance.findOneAndUpdate;
    }
    Attendance.findOneAndUpdate = async () => null;
    try {
      await attendanceService.punchOut('507f1f77bcf86cd799439011', new Date());
      expect.fail('should have thrown AttendanceStateError');
    } catch (err) {
      expect(err).to.be.instanceOf(AttendanceStateError);
      expect(err.message).to.equal('Attendance already checked out');
      expect(err.status).to.equal(409);
    } finally {
      Attendance.findOneAndUpdate = original;
    }
  });
});

/* ============================================================
   UNIT TESTS — scope resolution (no DB needed)
   ============================================================ */
describe('Attendance scope resolution (unit)', () => {
  const makeReq = (scope) => ({ admin: { scope } });

  it('male trainer resolves only Male', () => {
    expect(scopeResolver.getScopeAllowedGenders(makeReq('male'))).to.deep.equal(['Male']);
    expect(scopeResolver.checkMemberScope(makeReq('male'), 'Male')).to.be.true;
    expect(scopeResolver.checkMemberScope(makeReq('male'), 'Female')).to.be.false;
    expect(scopeResolver.checkMemberScope(makeReq('male'), 'Transgender')).to.be.false;
  });

  it('female trainer resolves Female + Transgender (shared sequence)', () => {
    expect(scopeResolver.getScopeAllowedGenders(makeReq('female_plus_transgender'))).to.deep.equal(['Female', 'Transgender']);
    expect(scopeResolver.checkMemberScope(makeReq('female_plus_transgender'), 'Female')).to.be.true;
    expect(scopeResolver.checkMemberScope(makeReq('female_plus_transgender'), 'Transgender')).to.be.true;
    expect(scopeResolver.checkMemberScope(makeReq('female_plus_transgender'), 'Male')).to.be.false;
  });

  it('superadmin (all) resolves every gender', () => {
    expect(scopeResolver.getScopeAllowedGenders(makeReq('all'))).to.deep.equal(['Male', 'Female', 'Transgender']);
    for (const gender of ['Male', 'Female', 'Transgender']) {
      expect(scopeResolver.checkMemberScope(makeReq('all'), gender)).to.be.true;
    }
  });
});

/* ============================================================
   INTEGRATION TESTS — require MongoDB (skip if unavailable)
   ============================================================ */
describe('Attendance identity + scope + concurrency (integration)', function () {
  this.timeout(30000);
  let connected = false;

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      await Attendance.deleteMany({});
      await Member.deleteMany({});
      await SystemSettings.deleteMany({});
    } catch (err) {
      this.skip();
    }
  });

  after(async () => {
    if (connected) {
      await Attendance.deleteMany({});
      await Member.deleteMany({});
      await mongoose.disconnect();
    }
  });

  const makeMember = async (gender, gymId, overrides = {}) =>
    Member.create({
      fullName: `Test ${gender} ${gymId}`,
      fatherName: 'Test',
      dob: new Date('1990-01-01'),
      bloodGroup: 'O+',
      gender,
      address: 'Test Address',
      occupation: 'Test',
      aadhar: String(100000000000 + Math.floor(Math.random() * 900000000000)),
      phone: `9${String(7000000000 + Math.floor(Math.random() * 2000000000))}`.slice(0, 10),
      gymId,
      gymPlan: '1 Month',
      trainingType: 'Weight Loss',
      paymentStatus: 'paid',
      status: 'active',
      validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ...overrides,
    });

  const makeReq = (scope) => ({ admin: { scope } });

  it('Male 192 and Female 192 are independent members', async () => {
    const male = await makeMember('Male', 192);
    const female = await makeMember('Female', 192);

    expect(male._id).to.not.equal(female._id);
    expect(male.gymId).to.equal(female.gymId);
    expect(male.gender).to.equal('Male');
    expect(female.gender).to.equal('Female');
  });

  it('attendance links to Member._id, not gymId', async () => {
    const male = await makeMember('Male', 193);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const record = await Attendance.create({
      memberId: male._id,
      date: today,
      checkInTime: new Date(),
      state: 'inside',
      source: 'test',
    });

    expect(String(record.memberId)).to.equal(String(male._id));
    const found = await Attendance.findOne({ memberId: male._id, date: today });
    expect(String(found.memberId)).to.equal(String(male._id));
  });

  it('male trainer can check in a Male member but NOT a Female member', async () => {
    const male = await makeMember('Male', 194);
    const female = await makeMember('Female', 194);
    const maleReq = makeReq('male');

    expect(scopeResolver.checkMemberScope(maleReq, male.gender)).to.be.true;
    expect(scopeResolver.checkMemberScope(maleReq, female.gender)).to.be.false;
  });

  it('female trainer sees Female + Transgender but NOT Male', async () => {
    const male = await makeMember('Male', 195);
    const female = await makeMember('Female', 195);
    const trans = await makeMember('Transgender', 196);
    const femaleReq = makeReq('female_plus_transgender');

    expect(scopeResolver.checkMemberScope(femaleReq, female.gender)).to.be.true;
    expect(scopeResolver.checkMemberScope(femaleReq, trans.gender)).to.be.true;
    expect(scopeResolver.checkMemberScope(femaleReq, male.gender)).to.be.false;
  });

  it('simultaneous punch-in creates exactly ONE record', async () => {
    const member = await makeMember('Male', 197);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await Attendance.deleteMany({ memberId: member._id, date: today });

    const results = await Promise.allSettled([
      attendanceService.punchIn(member._id, new Date(), { state: 'inside' }),
      attendanceService.punchIn(member._id, new Date(), { state: 'inside' }),
    ]);

    const records = await Attendance.find({ memberId: member._id, date: today });
    expect(records.length).to.equal(1);

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejectedWithStateError = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof AttendanceStateError
    ).length;

    expect(fulfilled).to.equal(1);
    expect(fulfilled + rejectedWithStateError).to.equal(2);
  });

  it('cross-gym same numeric ID creates two independent records under concurrency', async () => {
    const male = await makeMember('Male', 198);
    const female = await makeMember('Female', 198);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await Attendance.deleteMany({ memberId: { $in: [male._id, female._id] }, date: today });

    const [maleRes, femaleRes] = await Promise.allSettled([
      attendanceService.punchIn(male._id, new Date(), { state: 'inside' }),
      attendanceService.punchIn(female._id, new Date(), { state: 'inside' }),
    ]);

    expect(maleRes.status).to.equal('fulfilled');
    expect(femaleRes.status).to.equal('fulfilled');

    const maleRecords = await Attendance.find({ memberId: male._id, date: today });
    const femaleRecords = await Attendance.find({ memberId: female._id, date: today });
    expect(maleRecords.length).to.equal(1);
    expect(femaleRecords.length).to.equal(1);
    expect(String(maleRecords[0].memberId)).to.equal(String(male._id));
    expect(String(femaleRecords[0].memberId)).to.equal(String(female._id));
  });

  it('simultaneous check-out produces a single consistent checkout', async () => {
    const member = await makeMember('Male', 199);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await Attendance.deleteMany({ memberId: member._id, date: today });
    await attendanceService.punchIn(member._id, new Date(), { state: 'inside' });

    const results = await Promise.allSettled([
      attendanceService.punchOut(member._id, new Date()),
      attendanceService.punchOut(member._id, new Date()),
    ]);

    const records = await Attendance.find({ memberId: member._id, date: today });
    expect(records.length).to.equal(1);
    expect(records[0].checkOutTime).to.not.be.null;
    expect(records[0].state).to.equal('completed');

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejectedWithStateError = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof AttendanceStateError
    ).length;
    expect(fulfilled).to.equal(1);
    expect(fulfilled + rejectedWithStateError).to.equal(2);
  });

  // TEST 1: Check-in creates attendance
  it('TEST 1: valid member check-in creates attendance', async () => {
    const member = await makeMember('Male', 1001);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { attendance, isCheckOut } = await attendanceService.markAttendance(
      member._id,
      today
    );

    expect(attendance).to.exist;
    expect(attendance.memberId.toString()).to.equal(member._id.toString());
    expect(attendance.state).to.equal('inside');
    expect(attendance.checkInTime).to.exist;
    expect(attendance.checkOutTime).to.be.null;
    expect(isCheckOut).to.be.false;
  });

  // TEST 2: Check-out on second punch
  it('TEST 2: second punch same day checks out', async () => {
    const member = await makeMember('Male', 1002);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await attendanceService.markAttendance(member._id, today);
    const { attendance, isCheckOut } = await attendanceService.markAttendance(
      member._id,
      today
    );

    expect(isCheckOut).to.be.true;
    expect(attendance.state).to.equal('completed');
    expect(attendance.checkOutTime).to.exist;
    expect(attendance.durationMin).to.be.greaterThan(0);
  });

  // TEST 3: Duplicate punch blocked
  it('TEST 3: duplicate punch is blocked within the window', async () => {
    const member = await makeMember('Male', 1003);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await attendanceService.markAttendance(member._id, today);
    const isDuplicate = await attendanceService.checkDuplicate(member._id, today, 30);

    expect(isDuplicate).to.be.true;
  });

  // TEST 4: Expired member blocked
  it('TEST 4: expired member is blocked when configured', async () => {
    const member = await makeMember('Male', 1004, { validityEnd: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) });
    const settings = await systemSettingsService.getSettings();

    let error = null;
    try {
      await attendanceService.validateMemberExpiry(member._id, settings);
    } catch (err) {
      error = err;
    }

    expect(error).to.exist;
    expect(error.message).to.include('expired');
  });

  // TEST 5: Days left calculation
  it('TEST 5: days-left calculation is accurate', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const testDate = new Date(today);
    testDate.setDate(testDate.getDate() + 15);

    const daysLeft = attendanceService.calculateDaysLeft(testDate);
    expect(daysLeft).to.equal(15);
  });

  // TEST 7: Auto-close job
  it('TEST 7: auto-close closes open records', async () => {
    const member = await makeMember('Male', 1006);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    await Attendance.create({
      memberId: member._id,
      date: yesterday,
      checkInTime: new Date(yesterday.getTime() + 9 * 60 * 60 * 1000),
      checkOutTime: null,
      state: 'inside',
      source: 'counter',
    });

    const closed = await attendanceService.autoCloseOpenRecords(yesterday, '22:00');

    expect(closed).to.have.lengthOf(1);
    expect(closed[0].state).to.equal('auto_closed');
    expect(closed[0].checkOutTime).to.exist;
  });

  // TEST 10: Last attendance date update
  it('TEST 10: lastAttendanceDate updates on check-in', async () => {
    const member = await makeMember('Male', 1008);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    expect(member.lastAttendanceDate).to.be.null;

    await attendanceService.markAttendance(member._id, today);
    const updated = await Member.findById(member._id);

    expect(updated.lastAttendanceDate).to.exist;
    expect(updated.lastAttendanceDate.getTime()).to.be.greaterThan(today.getTime());
  });
});