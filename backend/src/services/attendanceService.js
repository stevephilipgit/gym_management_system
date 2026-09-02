import mongoose from 'mongoose';
import logger from '../core/logger.js';

const Attendance = mongoose.model('Attendance');
const Member = mongoose.model('Member');

/**
 * Business-level attendance state error.
 * Carries an HTTP status so controllers can return a clean response for
 * expected race outcomes (already checked in / already checked out) instead of
 * a generic 500 caused by an E11000 duplicate-key race.
 */
export class AttendanceStateError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'AttendanceStateError';
    this.status = status;
  }
}

const isDuplicateKeyError = (error) =>
  error?.code === 11000 || error?.name === 'MongoServerError' && error?.code === 11000;

/**
 * Core attendance business logic
 */
class AttendanceService {
  /**
   * Atomic check-in.
   *
   * Concurrency-safe: MongoDB's unique index { memberId, date } is the final
   * guard. When two requests race to create the same member+day record, exactly
   * one insert wins; the loser receives E11000 and is re-read as an existing
   * record, then surfaced as a clean "already checked in" business response.
   *
   * @returns {{ attendance, isCheckOut: boolean }}
   * @throws {AttendanceStateError} when the record already exists (race or
   *         duplicate action)
   */
  async punchIn(memberId, date = new Date(), { state = 'inside', source = 'counter' } = {}) {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);
    const now = new Date();

    try {
      const attendance = await Attendance.create({
        memberId,
        date: normalizedDate,
        checkInTime: now,
        state,
        source,
      });

      // Update member's lastAttendanceDate
      await Member.updateOne({ _id: memberId }, { lastAttendanceDate: now });
      logger.info(`Check-in recorded for member ${memberId}`, {
        attendanceId: attendance._id,
        date: normalizedDate,
      });

      return { attendance, isCheckOut: false };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // Expected race: another request already created today's record.
        logger.warn(`Concurrent check-in detected for member ${memberId}`);
        throw new AttendanceStateError('Already checked in for today', 409);
      }
      logger.error('Error during check-in', { memberId, error });
      throw error;
    }
  }

  /**
   * Atomic check-out.
   *
   * Concurrency-safe: only updates a record that still has checkOutTime === null.
   * The first concurrent request wins; the second matches nothing and receives a
   * clean "already checked out" business response. Never overwrites a meaningful
   * checkout timestamp, never creates a second record.
   *
   * The state transition is computed inside a single atomic update:
   *   late → stays late; inside → completed.
   *
   * @returns {{ attendance, isCheckOut: boolean }}
   * @throws {AttendanceStateError} when there is no open record to check out
   */
  async punchOut(memberId, date = new Date()) {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);
    const now = new Date();

    const updated = await Attendance.findOneAndUpdate(
      {
        memberId,
        date: normalizedDate,
        checkInTime: { $ne: null },
        checkOutTime: null,
      },
      [
        {
          $set: {
            checkOutTime: now,
            durationMin: {
              $floor: {
                $divide: [{ $subtract: [now, '$checkInTime'] }, 60000],
              },
            },
            state: { $cond: [{ $eq: ['$state', 'late'] }, 'late', 'completed'] },
          },
        },
      ],
      { new: true }
    );

    if (!updated) {
      throw new AttendanceStateError('Attendance already checked out', 409);
    }

    logger.info(`Check-out recorded for member ${memberId}`, {
      attendanceId: updated._id,
      durationMin: updated.durationMin,
    });

    return { attendance: updated, isCheckOut: true };
  }

  /**
   * Mark attendance: check-in if no record, check-out if already checked-in.
   * Uses the atomic primitives so concurrent requests cannot duplicate records
   * or corrupt state.
   */
  async markAttendance(memberId, date = new Date()) {
    try {
      const normalizedDate = new Date(date);
      normalizedDate.setHours(0, 0, 0, 0);

      const existing = await Attendance.findOne({
        memberId,
        date: normalizedDate,
      });

      if (!existing) {
        return await this.punchIn(memberId, normalizedDate, { state: 'inside', source: 'counter' });
      }

      if (existing.checkInTime && !existing.checkOutTime) {
        return await this.punchOut(memberId, normalizedDate);
      }

      throw new AttendanceStateError('Attendance already completed today', 409);
    } catch (error) {
      logger.error('Error marking attendance', { memberId, error });
      throw error;
    }
  }

  /**
   * Check if member can attend (expiry + business rules)
   */
  async validateMemberExpiry(memberId, settings) {
    try {
      const member = await Member.findById(memberId);
      if (!member) throw new Error('Member not found');

      const daysLeft = this.calculateDaysLeft(member.validityEnd);

      if (daysLeft < -settings.expiredGraceDays) {
        if (settings.blockExpiredMembers) {
          throw new Error(
            `Member expired ${Math.abs(daysLeft)} days ago. Attendance blocked.`
          );
        }
      }

      return { valid: true, daysLeft, member };
    } catch (error) {
      logger.error('Error validating member expiry', { memberId, error });
      throw error;
    }
  }

  /**
   * Calculate days left until expiry (can be negative)
   */
  calculateDaysLeft(validityEndDate) {
    if (!validityEndDate) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiryDate = new Date(validityEndDate);
    expiryDate.setHours(0, 0, 0, 0);

    const diffTime = expiryDate - today;
    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return daysLeft;
  }

  /**
   * Check if duplicate punch within N seconds
   */
  async checkDuplicate(memberId, date, windowSeconds = 30) {
    try {
      const normalizedDate = new Date(date);
      normalizedDate.setHours(0, 0, 0, 0);

      const attendance = await Attendance.findOne({
        memberId,
        date: normalizedDate,
      }).sort({ createdAt: -1 });

      if (!attendance) return false;

      const now = new Date();
      const secondsSinceCreated = (now - attendance.createdAt) / 1000;

      return secondsSinceCreated < windowSeconds;
    } catch (error) {
      logger.error('Error checking duplicate', { memberId, error });
      throw error;
    }
  }

  /**
   * Auto-close open records (missing checkout)
   */
  async autoCloseOpenRecords(date, closingTime = '22:00') {
    try {
      const normalizedDate = new Date(date);
      normalizedDate.setHours(0, 0, 0, 0);

      // Parse closing time (HH:MM format)
      const [hours, minutes] = closingTime.split(':').map(Number);
      const closeDateTime = new Date(normalizedDate);
      closeDateTime.setHours(hours, minutes, 0, 0);

      // Find records without checkout
      const openRecords = await Attendance.find({
        date: normalizedDate,
        checkOutTime: null,
      });

      const updated = [];
      for (const record of openRecords) {
        record.checkOutTime = closeDateTime;
        record.state = 'auto_closed';
        record.durationMin = Math.floor(
          (closeDateTime - record.checkInTime) / (1000 * 60)
        );
        record.source = 'startup_recovery';
        await record.save();
        updated.push(record);
      }

      logger.info(`Auto-closed ${updated.length} open attendance records`, {
        date: normalizedDate,
        closingTime,
      });

      return updated;
    } catch (error) {
      logger.error('Error auto-closing open records', { error });
      throw error;
    }
  }

  /**
   * Get today's stats (simple counts)
   * When memberIds is provided, only attendance belonging to those members is
   * counted (gender-scoped query). memberIds = null counts everything (superadmin).
   */
  async getTodayStats(memberIds = null) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const baseFilter = { date: today };
      const scopeFilter = Array.isArray(memberIds)
        ? { ...baseFilter, memberId: { $in: memberIds } }
        : baseFilter;

      const totalPunches = await Attendance.countDocuments(scopeFilter);

      const activePunches = await Attendance.countDocuments({
        ...scopeFilter,
        state: 'inside',
      });

      const completedPunches = await Attendance.countDocuments({
        ...scopeFilter,
        state: 'completed',
      });

      return {
        date: today,
        totalPunches,
        activePunches,
        completedPunches,
      };
    } catch (error) {
      logger.error('Error getting today stats', { error });
      throw error;
    }
  }

  /**
   * Get last attendance for a member
   */
  async getLastAttendance(memberId) {
    try {
      const last = await Attendance.findOne({ memberId })
        .sort({ date: -1, checkInTime: -1 })
        .lean();
      return last || null;
    } catch (error) {
      logger.error('Error getting last attendance', { memberId, error });
      throw error;
    }
  }
}

export default new AttendanceService();
