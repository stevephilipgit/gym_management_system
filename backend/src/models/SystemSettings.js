import mongoose from 'mongoose';

const systemSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'gym_rules',
      unique: true,
    },
    // Attendance Rules
    oneVisitPerDay: {
      type: Boolean,
      default: true,
    },
    duplicatePunchSeconds: {
      type: Number,
      default: 30,
    },
    latePunchThreshold: {
      type: String,
      default: '21:00',
    },
    openingTime: {
      type: String,
      default: '04:00',
    },
    closingTime: {
      type: String,
      default: '22:00',
    },
    // Membership Rules
    blockExpiredMembers: {
      type: Boolean,
      default: true,
    },
    expiredGraceDays: {
      type: Number,
      default: 0,
    },
    // Front Desk UX
    soundEnabled: {
      type: Boolean,
      default: true,
    },
    // Metadata
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model('SystemSettings', systemSettingsSchema);
