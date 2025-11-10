/**
 * Critical Test Cases for Attendance System
 * Tests the 5 core flows: check-in, check-out, duplicate block, expiry block, correction
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { expect } from 'chai';

dotenv.config();

// Import models and services
import '../src/models/Attendance.js';
import '../src/models/Member.js';
import '../src/models/SystemSettings.js';
import attendanceService from '../src/services/attendanceService.js';
import systemSettingsService from '../src/services/systemSettingsService.js';

const Attendance = mongoose.model('Attendance');
const Member = mongoose.model('Member');
const SystemSettings = mongoose.model('SystemSettings');

// Connect to DB
async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/gym_test');
}

async function cleanDB() {
  await Attendance.deleteMany({});
  await Member.deleteMany({});
  await SystemSettings.deleteMany({});
}

// Test helper: Create test member
async function createTestMember(gymId, phone, validityDays) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + validityDays);

  const member = await Member.create({
    gymId,
    fullName: `Test Member ${gymId}`,
    fatherName: 'Father',
    dob: new Date(1990, 1, 1),
    bloodGroup: 'O+',
    gender: 'Male',
    phone,
    aadhar: '123456789012',
    occupation: 'Engineer',
    address: 'Test Address',
    gymPlan: '1 Month',
    trainingType: 'Weight Loss',
    paymentStatus: 'paid',
    validityEnd: expiryDate,
    status: 'active',
  });

  return member;
}

// TEST SUITE
describe('Attendance System - Critical Flows', () => {
  before(async () => {
    await connectDB();
    await cleanDB();
    await systemSettingsService.getSettings();
  });

  after(async () => {
    await cleanDB();
    await mongoose.connection.close();
  });

  // TEST 1: Check-in creates attendance
  describe('TEST 1: Valid Member Check-in', () => {
    it('should create attendance record on first punch', async () => {
      const member = await createTestMember(1001, '9876543210', 30);
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

      console.log('✓ TEST 1 PASSED: Check-in created successfully');
    });
  });

  // TEST 2: Check-out on second punch
  describe('TEST 2: Valid Member Check-out', () => {
    it('should mark check-out on second punch same day', async () => {
      const member = await createTestMember(1002, '9876543211', 30);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // First punch: check-in
      await attendanceService.markAttendance(member._id, today);

      // Second punch: check-out
      const { attendance, isCheckOut } = await attendanceService.markAttendance(
        member._id,
        today
      );

      expect(isCheckOut).to.be.true;
      expect(attendance.state).to.equal('completed');
      expect(attendance.checkOutTime).to.exist;
      expect(attendance.durationMin).to.be.greaterThan(0);

      console.log('✓ TEST 2 PASSED: Check-out marked successfully');
    });
  });

  // TEST 3: Duplicate punch blocked
  describe('TEST 3: Duplicate Punch Prevention', () => {
    it('should block duplicate punch within 30 seconds', async () => {
      const member = await createTestMember(1003, '9876543212', 30);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // First punch
      await attendanceService.markAttendance(member._id, today);

      // Try duplicate within 30 seconds
      const isDuplicate = await attendanceService.checkDuplicate(
        member._id,
        today,
        30
      );

      expect(isDuplicate).to.be.true;

      console.log('✓ TEST 3 PASSED: Duplicate punch blocked');
    });
  });

  // TEST 4: Expired member blocked
  describe('TEST 4: Expired Member Blocking', () => {
    it('should block expired member when configured', async () => {
      const member = await createTestMember(1004, '9876543213', -5); // Expired 5 days ago
      const settings = await systemSettingsService.getSettings();

      let error = null;
      try {
        await attendanceService.validateMemberExpiry(member._id, settings);
      } catch (err) {
        error = err;
      }

      expect(error).to.exist;
      expect(error.message).to.include('expired');

      console.log('✓ TEST 4 PASSED: Expired member blocked');
    });
  });

  // TEST 5: Days left calculation
  describe('TEST 5: DaysLeft Calculation Accuracy', () => {
    it('should calculate daysLeft correctly', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const testDate = new Date(today);
      testDate.setDate(testDate.getDate() + 15); // 15 days from now

      const daysLeft = attendanceService.calculateDaysLeft(testDate);

      expect(daysLeft).to.equal(15);

      console.log('✓ TEST 5 PASSED: DaysLeft calculated correctly');
    });
  });

  // TEST 6: Manual correction
  describe('TEST 6: Admin Attendance Correction', () => {
    it('should correct check-in time', async () => {
      const member = await createTestMember(1005, '9876543214', 30);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Create initial record
      const { attendance } = await attendanceService.markAttendance(
        member._id,
        today
      );

      const originalTime = attendance.checkInTime;

      // Correct the time
      const newCheckInTime = new Date(originalTime);
      newCheckInTime.setHours(10, 30, 0, 0);

      const corrected = await attendanceService.correctCheckInTime(
        attendance._id,
        newCheckInTime,
        'admin-id'
      );

      expect(corrected.checkInTime.getTime()).to.not.equal(originalTime.getTime());
      expect(corrected.correctedBy).to.equal('admin-id');

      console.log('✓ TEST 6 PASSED: Attendance corrected successfully');
    });
  });

  // TEST 7: Auto-close job
  describe('TEST 7: Auto-Close Open Records', () => {
    it('should auto-close open attendance records', async () => {
      const member = await createTestMember(1006, '9876543215', 30);
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      // Create open record from yesterday
      await Attendance.create({
        memberId: member._id,
        date: yesterday,
        checkInTime: new Date(yesterday.getTime() + 9 * 60 * 60 * 1000), // 9 AM
        checkOutTime: null,
        state: 'inside',
        source: 'counter',
      });

      // Run auto-close
      const closed = await attendanceService.autoCloseOpenRecords(
        yesterday,
        '22:00'
      );

      expect(closed).to.have.lengthOf(1);
      expect(closed[0].state).to.equal('auto_closed');
      expect(closed[0].checkOutTime).to.exist;

      console.log('✓ TEST 7 PASSED: Auto-close job executed successfully');
    });
  });

  // TEST 8: Add missed attendance
  describe('TEST 8: Admin Add Missed Attendance', () => {
    it('should add missed attendance record', async () => {
      const member = await createTestMember(1007, '9876543216', 30);
      const date = new Date();
      date.setDate(date.getDate() - 1);
      date.setHours(0, 0, 0, 0);

      const checkInTime = new Date(date);
      checkInTime.setHours(9, 0, 0, 0);

      const checkOutTime = new Date(date);
      checkOutTime.setHours(17, 0, 0, 0);

      const attendance = await attendanceService.addMissedAttendance(
        member._id,
        date,
        checkInTime,
        checkOutTime,
        'admin-id'
      );

      expect(attendance).to.exist;
      expect(attendance.state).to.equal('completed');
      expect(attendance.durationMin).to.be.greaterThan(0);
      expect(attendance.source).to.equal('manual');

      console.log('✓ TEST 8 PASSED: Missed attendance added successfully');
    });
  });

  // TEST 9: Settings get and update
  describe('TEST 9: System Settings Management', () => {
    it('should get and update settings', async () => {
      const settings1 = await systemSettingsService.getSettings();
      expect(settings1.oneVisitPerDay).to.be.true;

      // Update settings
      await systemSettingsService.updateSettings(
        { oneVisitPerDay: false },
        'admin-id'
      );

      // Invalidate cache and fetch again
      systemSettingsService.invalidateCache();
      const settings2 = await systemSettingsService.getSettings();
      expect(settings2.oneVisitPerDay).to.be.false;

      console.log('✓ TEST 9 PASSED: Settings updated successfully');
    });
  });

  // TEST 10: Last attendance date update
  describe('TEST 10: LastAttendanceDate Update', () => {
    it('should update member lastAttendanceDate on check-in', async () => {
      const member = await createTestMember(1008, '9876543217', 30);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      expect(member.lastAttendanceDate).to.be.null;

      // Mark attendance
      await attendanceService.markAttendance(member._id, today);

      // Fetch updated member
      const updated = await Member.findById(member._id);

      expect(updated.lastAttendanceDate).to.exist;
      expect(updated.lastAttendanceDate.getTime()).to.be.greaterThan(
        today.getTime()
      );

      console.log('✓ TEST 10 PASSED: LastAttendanceDate updated correctly');
    });
  });
});

// RUN TESTS
describe('Attendance System - Full Test Suite', () => {
  console.log(
    '\n╔════════════════════════════════════════╗'
  );
  console.log('║  Running Critical Tests                ║');
  console.log('╚════════════════════════════════════════╝\n');
});
