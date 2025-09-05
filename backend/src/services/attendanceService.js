import mongoose from 'mongoose';
import logger from '../core/logger.js';

const Attendance = mongoose.model('Attendance');
const Member = mongoose.model('Member');

/**
 * Core attendance business logic
 */
class AttendanceService {
  /**
   * Mark attendance: check-in if no record, check-out if already checked-in
   */
  async markAttendance(memberId, date = new Date()) {
    try {
      const normalizedDate = new Date(date);
      normalizedDate.setHours(0, 0, 0, 0);

      // Get today's record if exists
      let attendance = await Attendance.findOne({
        memberId,
        date: normalizedDate,
      });

      const now = new Date();

      if (!attendance) {
        // Create new check-in record
        attendance = new Attendance({
          memberId,
          date: normalizedDate,
          checkInTime: now,
          state: 'inside',
          source: 'counter',
        });
        await attendance.save();

        // Update member's lastAttendanceDate
        await Member.updateOne(
          { _id: memberId },
          { lastAttendanceDate: now }
        );

        logger.info(`Check-in recorded for member ${memberId}`, {
          attendanceId: attendance._id,
          date: normalizedDate,
        });

        return { attendance, isCheckOut: false };
      }

      // If attendance exists but no checkout, mark as checkout
      if (attendance.checkInTime && !attendance.checkOutTime) {
        const durationMin = Math.floor(
          (now - attendance.checkInTime) / (1000 * 60)
        );
        attendance.checkOutTime = now;
        attendance.durationMin = durationMin;
        attendance.state = 'completed';
        await attendance.save();

        logger.info(`Check-out recorded for member ${memberId}`, {
          attendanceId: attendance._id,
          durationMin,
        });

        return { attendance, isCheckOut: true };
      }

      // Already has both checkin and checkout, treat as new checkin (error case)
      throw new Error('Attendance already completed today');
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
   * Correct check-in time
   */
  async correctCheckInTime(attendanceId, newCheckInTime, adminId) {
    try {
      const attendance = await Attendance.findByIdAndUpdate(
        attendanceId,
        {
          checkInTime: newCheckInTime,
          correctedBy: adminId,
        },
        { new: true }
      );

      if (attendance.checkOutTime) {
        const durationMin = Math.floor(
          (attendance.checkOutTime - newCheckInTime) / (1000 * 60)
        );
        attendance.durationMin = durationMin;
        await attendance.save();
      }

      logger.info(`Check-in time corrected for attendance ${attendanceId}`, {
        newCheckInTime,
        correctedBy: adminId,
      });

      return attendance;
    } catch (error) {
      logger.error('Error correcting check-in time', { attendanceId, error });
      throw error;
    }
  }

  /**
   * Correct check-out time
   */
  async correctCheckOutTime(attendanceId, newCheckOutTime, adminId) {
    try {
      const attendance = await Attendance.findByIdAndUpdate(
        attendanceId,
        {
          checkOutTime: newCheckOutTime,
          correctedBy: adminId,
        },
        { new: true }
      );

      if (attendance.checkInTime) {
        const durationMin = Math.floor(
          (newCheckOutTime - attendance.checkInTime) / (1000 * 60)
        );
        attendance.durationMin = durationMin;
        await attendance.save();
      }

      logger.info(`Check-out time corrected for attendance ${attendanceId}`, {
        newCheckOutTime,
        correctedBy: adminId,
      });

      return attendance;
    } catch (error) {
      logger.error('Error correcting check-out time', { attendanceId, error });
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
   * Add missed attendance manually
   */
  async addMissedAttendance(memberId, date, checkInTime, checkOutTime, adminId) {
    try {
      const normalizedDate = new Date(date);
      normalizedDate.setHours(0, 0, 0, 0);

      // Check if record already exists
      const existing = await Attendance.findOne({
        memberId,
        date: normalizedDate,
      });

      if (existing) {
        throw new Error('Attendance record already exists for this date');
      }

      const durationMin = checkOutTime
        ? Math.floor((checkOutTime - checkInTime) / (1000 * 60))
        : null;

      const attendance = new Attendance({
        memberId,
        date: normalizedDate,
        checkInTime,
        checkOutTime: checkOutTime || null,
        durationMin,
        state: checkOutTime ? 'completed' : 'inside',
        source: 'manual',
        correctedBy: adminId,
      });

      await attendance.save();

      // Update member's lastAttendanceDate if checkout exists
      if (checkOutTime) {
        await Member.updateOne(
          { _id: memberId },
          { lastAttendanceDate: checkOutTime }
        );
      }

      logger.info(`Missed attendance added for member ${memberId}`, {
        attendanceId: attendance._id,
        date: normalizedDate,
        addedBy: adminId,
      });

      return attendance;
    } catch (error) {
      logger.error('Error adding missed attendance', { memberId, error });
      throw error;
    }
  }

  /**
   * Get today's stats (simple counts)
   */
  async getTodayStats() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const totalPunches = await Attendance.countDocuments({
        date: today,
      });

      const activePunches = await Attendance.countDocuments({
        date: today,
        state: 'inside',
      });

      const completedPunches = await Attendance.countDocuments({
        date: today,
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
