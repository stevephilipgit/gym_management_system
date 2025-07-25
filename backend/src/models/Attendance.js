import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Member',
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    checkInTime: {
      type: Date,
      required: true,
    },
    checkOutTime: {
      type: Date,
      default: null,
    },
    durationMin: {
      type: Number,
      default: null,
    },
    state: {
      type: String,
      enum: ['inside', 'completed', 'auto_closed', 'late'],
      required: true,
    },
    source: {
      type: String,
      enum: ['counter', 'manual', 'correction', 'startup_recovery'],
      default: 'counter',
    },
    correctedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Unique index: one attendance per member per day
attendanceSchema.index({ memberId: 1, date: 1 }, { unique: true });

export default mongoose.model('Attendance', attendanceSchema);
