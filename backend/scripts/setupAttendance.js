/**
 * Setup script for attendance system
 * Run this once to initialize indexes and default settings
 *
 * Usage: node scripts/setupAttendance.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import models
import '../src/models/Attendance.js';
import '../src/models/SystemSettings.js';
import '../src/models/Member.js';

const Attendance = mongoose.model('Attendance');
const SystemSettings = mongoose.model('SystemSettings');
const Member = mongoose.model('Member');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/gym_management');
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

const createIndexes = async () => {
  try {
    console.log('\n📍 Creating indexes...\n');

    // Attendance indexes
    await Attendance.collection.createIndex({ memberId: 1, date: 1 }, { unique: true });
    console.log('✅ Created unique index on Attendance(memberId, date)');

    await Attendance.collection.createIndex({ date: 1 });
    console.log('✅ Created index on Attendance(date)');

    await Attendance.collection.createIndex({ checkInTime: 1 });
    console.log('✅ Created index on Attendance(checkInTime)');

    // Member lastAttendanceDate index
    await Member.collection.createIndex({ lastAttendanceDate: 1 });
    console.log('✅ Created index on Member(lastAttendanceDate)');

    console.log('\n✅ All indexes created successfully!\n');
  } catch (error) {
    console.error('❌ Error creating indexes:', error.message);
    throw error;
  }
};

const seedDefaultSettings = async () => {
  try {
    console.log('📍 Seeding default settings...\n');

    const existing = await SystemSettings.findOne({ key: 'gym_rules' });

    if (existing) {
      console.log('ℹ️  Settings already exist. Skipping seed.');
      console.log('Current settings:', existing.toObject());
      return;
    }

    const defaults = {
      key: 'gym_rules',
      oneVisitPerDay: true,
      duplicatePunchSeconds: 30,
      latePunchThreshold: '21:00',
      closingTime: '22:00',
      blockExpiredMembers: true,
      expiredGraceDays: 0,
      soundEnabled: true,
    };

    await SystemSettings.create(defaults);
    console.log('✅ Default settings created:\n', defaults);
  } catch (error) {
    console.error('❌ Error seeding settings:', error.message);
    throw error;
  }
};

const setup = async () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   Attendance System Setup Script       ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    await connectDB();
    await createIndexes();
    await seedDefaultSettings();

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   ✅ Setup Completed Successfully!     ║');
    console.log('╚════════════════════════════════════════╝\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
};

setup();
