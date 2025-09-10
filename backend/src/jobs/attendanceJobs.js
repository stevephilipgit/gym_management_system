import mongoose from 'mongoose';
import systemSettingsService from '../services/systemSettingsService.js';
import attendanceService from '../services/attendanceService.js';
import logger from '../core/logger.js';
import attendanceLogger from '../core/attendanceLogger.js';

const Attendance = mongoose.model('Attendance');

/**
 * Auto-close attendance records (called at 11:59 PM daily)
 * Closes any open attendance records from today
 */
async function autoCloseJob() {
  try {
    logger.info('Auto-close job started');

    const settings = await systemSettingsService.getSettings();
    const closingTime = settings.closingTime || '22:00';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const closed = await attendanceService.autoCloseOpenRecords(today, closingTime);

    logger.info(`Auto-close job completed. Closed ${closed.length} records`, {
      date: today,
      closingTime,
    });

    return {
      success: true,
      closedCount: closed.length,
      date: today,
    };
  } catch (error) {
    logger.error('Error in auto-close job', { error });
    throw error;
  }
}

/**
 * Startup recovery job (called on server start)
 * Auto-closes any open records from yesterday if server was down
 */
async function startupRecoveryJob() {
  try {
    logger.info('Startup recovery job started');

    const settings = await systemSettingsService.getSettings();
    const closingTime = settings.closingTime || '22:00';

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const closed = await attendanceService.autoCloseOpenRecords(
      yesterday,
      closingTime
    );

    if (closed.length > 0) {
      logger.warn(
        `Startup recovery: Auto-closed ${closed.length} open records from yesterday`,
        { date: yesterday }
      );
    }

    return {
      success: true,
      recoveredCount: closed.length,
      date: yesterday,
    };
  } catch (error) {
    logger.error('Error in startup recovery job', { error });
    // Don't throw - allow server to start even if recovery fails
  }
}

/**
 * Stale record auto-close job
 * Marks 'inside' records as 'completed' if checked-in > 2 hours ago without checkout
 */
async function staleAutoCloseJob() {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const staleRecords = await Attendance.find({
      date: today,
      state: { $in: ['inside'] },
      checkOutTime: null,
      checkInTime: { $lte: twoHoursAgo },
    });

    for (const record of staleRecords) {
      const now = new Date();
      const durationMin = Math.floor((now - record.checkInTime) / (1000 * 60));
      record.checkOutTime = now;
      record.durationMin = durationMin;
      record.state = 'completed';
      record.source = 'startup_recovery';
      await record.save();

      attendanceLogger.info(`Auto-Closed Stale Record | MemberID=${record.memberId} | Duration=${durationMin}m`);
    }

    if (staleRecords.length > 0) {
      logger.info(`Stale auto-close: Closed ${staleRecords.length} records older than 2 hours`);
    }

    return { closedCount: staleRecords.length };
  } catch (error) {
    logger.error('Error in stale auto-close job', { error });
  }
}

export {
  autoCloseJob,
  startupRecoveryJob,
  staleAutoCloseJob,
};

