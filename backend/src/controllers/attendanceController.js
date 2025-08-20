import mongoose from 'mongoose';
import attendanceService from '../services/attendanceService.js';
import systemSettingsService from '../services/systemSettingsService.js';
import auditLog from '../utils/auditLog.js';
import logger from '../core/logger.js';
import attendanceLogger from '../core/attendanceLogger.js';

const Attendance = mongoose.model('Attendance');
const Member = mongoose.model('Member');

/**
 * Sanitize input - strip dangerous chars, trim
 */
function sanitizeInput(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/[<>'"`;\\\/\{\}\[\]\(\)&$!|]/g, '') // strip dangerous chars
    .replace(/\s+/g, '');                           // remove all whitespace
}

/**
 * Validate search input - returns { type, value, error }
 */
function validateSearchInput(input) {
  const sanitized = sanitizeInput(input);

  if (!sanitized) {
    return { type: null, value: null, error: 'Please enter a Gym ID or Phone Number' };
  }

  // Must be numeric only
  const digitsOnly = sanitized.replace(/\D/g, '');
  if (digitsOnly.length !== sanitized.length) {
    return { type: null, value: null, error: 'Only numeric input allowed' };
  }

  // Phone: exactly 10 digits starting with 6-9
  if (/^[6-9]\d{9}$/.test(digitsOnly)) {
    return { type: 'phone', value: digitsOnly, error: null };
  }

  // Reject >10 digits
  if (digitsOnly.length > 10) {
    return { type: null, value: null, error: 'Phone must be exactly 10 digits' };
  }

  // Gym ID: min 4 digits, positive integer
  if (digitsOnly.length >= 1) {
    const num = parseInt(digitsOnly, 10);
    if (num <= 0) {
      return { type: null, value: null, error: 'Gym ID must be a positive number' };
    }
    return { type: 'gymId', value: num, error: null };
  }

  return { type: null, value: null, error: 'Invalid input format' };
}

/**
 * Check if current time is within business hours
 */
function isWithinBusinessHours(openingTime, closingTime) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [openH, openM] = (openingTime || '04:00').split(':').map(Number);
  const [closeH, closeM] = (closingTime || '22:00').split(':').map(Number);

  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
}

/**
 * Check if current time is after late threshold
 */
function isLateEntry(latePunchThreshold) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [lateH, lateM] = (latePunchThreshold || '21:00').split(':').map(Number);
  const lateMinutes = lateH * 60 + lateM;

  return currentMinutes >= lateMinutes;
}

// POST /api/attendance/search-punch
export const searchPunch = async (req, res) => {
  try {
    const rawInput = req.body.input;

    attendanceLogger.info(`Search Attempt | Input=${sanitizeInput(rawInput)}`);

    // 1. Validate + sanitize
    const { type, value, error } = validateSearchInput(rawInput);
    if (error) {
      attendanceLogger.warn(`Invalid Search Input | Raw=${sanitizeInput(rawInput)} | Reason=${error}`);
      return res.status(400).json({
        success: false,
        message: error,
      });
    }

    // 2. Find member
    let member;
    if (type === 'phone') {
      member = await Member.findOne({ phone: value }).lean();
    } else {
      member = await Member.findOne({ gymId: value }).lean();
    }

    if (!member) {
      attendanceLogger.warn(`Member Not Found | Input=${value} | Type=${type}`);
      return res.status(404).json({
        success: false,
        message: 'Member not found',
      });
    }

    attendanceLogger.info(`Member Found | MemberID=${member.gymId} | Name=${member.fullName}`);

    // 3. Get settings
    const settings = await systemSettingsService.getSettings();

    // 4. Check business hours
    if (!isWithinBusinessHours(settings.openingTime, settings.closingTime)) {
      attendanceLogger.warn(`Gym Closed Attempt | MemberID=${member.gymId}`);
      return res.status(403).json({
        success: false,
        gymClosed: true,
        message: `Gym is closed. Operating hours: ${settings.openingTime || '04:00'} AM - ${settings.closingTime || '22:00'} PM`,
        openingTime: settings.openingTime || '04:00',
        closingTime: settings.closingTime || '22:00',
      });
    }

    // 5. Check expiry
    const daysLeft = attendanceService.calculateDaysLeft(member.validityEnd);
    if (daysLeft < -settings.expiredGraceDays && settings.blockExpiredMembers) {
      attendanceLogger.warn(`Expired Member Blocked | MemberID=${member.gymId}`);
      return res.status(403).json({
        success: false,
        message: `Membership expired ${Math.abs(daysLeft)} days ago. Entry blocked.`,
      });
    }

    // 6. Check duplicate punch
    const isDuplicate = await attendanceService.checkDuplicate(
      member._id,
      new Date(),
      settings.duplicatePunchSeconds
    );
    if (isDuplicate) {
      attendanceLogger.warn(`Duplicate Punch Blocked | MemberID=${member.gymId}`);
      return res.status(429).json({
        success: false,
        message: 'Recent punch already recorded. Please wait.',
      });
    }

    // 7. Determine late status
    const isLate = isLateEntry(settings.latePunchThreshold);

    // 8. Check today's record
    const normalizedDate = new Date();
    normalizedDate.setHours(0, 0, 0, 0);
    const now = new Date();

    let existingRecord = await Attendance.findOne({
      memberId: member._id,
      date: normalizedDate,
    });

    let isCheckOut = false;
    let attendance;

    if (!existingRecord) {
      // SCENARIO A: First entry of day — Check-in
      const state = isLate ? 'late' : 'inside';

      attendance = new Attendance({
        memberId: member._id,
        date: normalizedDate,
        checkInTime: now,
        state,
        source: 'counter',
      });
      await attendance.save();

      // Update member lastAttendanceDate
      await Member.updateOne({ _id: member._id }, { lastAttendanceDate: now });

      if (isLate) {
        attendanceLogger.info(`Late Entry | MemberID=${member.gymId} | Time=${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`);
      } else {
        attendanceLogger.info(`Check-In | MemberID=${member.gymId} | Time=${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} | Status=Inside Gym`);
      }
    } else if (existingRecord.checkInTime && !existingRecord.checkOutTime) {
      // SCENARIO B: Already inside, entering again — Check-out
      isCheckOut = true;
      const durationMin = Math.floor((now - existingRecord.checkInTime) / (1000 * 60));

      existingRecord.checkOutTime = now;
      existingRecord.durationMin = durationMin;
      // If already marked late, keep late; otherwise mark completed
      if (existingRecord.state !== 'late') {
        existingRecord.state = 'completed';
      }
      await existingRecord.save();
      attendance = existingRecord;

      attendanceLogger.info(`Check-Out | MemberID=${member.gymId} | Time=${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} | Status=${existingRecord.state === 'late' ? 'Late' : 'Visited'}`);
    } else {
      // Already completed today
      attendanceLogger.warn(`Already Completed | MemberID=${member.gymId}`);
      return res.status(409).json({
        success: false,
        message: 'Attendance already completed for today',
      });
    }

    // 9. Build response with full member details
    const checkInTimeFormatted = attendance.checkInTime
      ? new Date(attendance.checkInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
      : null;
    const checkOutTimeFormatted = attendance.checkOutTime
      ? new Date(attendance.checkOutTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
      : null;

    const statusLabel = attendance.state === 'late' ? 'Late' :
                         attendance.state === 'inside' ? 'Inside Gym' :
                         attendance.state === 'completed' ? 'Visited' : attendance.state;

    const validityEndFormatted = member.validityEnd
      ? new Date(member.validityEnd).toLocaleDateString('en-GB')
      : 'N/A';

    res.json({
      success: true,
      message: isCheckOut ? 'Check-out successful' : (isLate ? 'Late Entry recorded' : 'Check-in successful'),
      isCheckOut,
      isLate: attendance.state === 'late',
      attendance: {
        _id: attendance._id,
        checkInTime: attendance.checkInTime,
        checkOutTime: attendance.checkOutTime,
        state: attendance.state,
        durationMin: attendance.durationMin,
      },
      member: {
        _id: member._id,
        gymId: member.gymId,
        name: member.fullName,
        phone: member.phone,
        plan: member.gymPlan,
        photoUrl: member.photoUrl,
        daysLeft,
        status: daysLeft > 0 ? 'active' : daysLeft === 0 ? 'lastday' : 'expired',
        validityEnd: validityEndFormatted,
      },
      display: {
        checkInTime: checkInTimeFormatted,
        checkOutTime: checkOutTimeFormatted,
        statusLabel,
      },
    });
  } catch (error) {
    logger.error('Error in searchPunch', { error });
    attendanceLogger.warn(`Search Punch Error | ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to process attendance',
      error: error.message,
    });
  }
};

/**
 * Attendance Controller - Punch, corrections, and stats
 */

// POST /api/attendance/punch
export const markAttendance = async (req, res) => {
  try {
    const { memberId } = req.body;
    const adminId = req.user ? req.user.id : null;

    // Get settings
    const settings = await systemSettingsService.getSettings();

    // Check if duplicate punch
    const isDuplicate = await attendanceService.checkDuplicate(
      memberId,
      new Date(),
      settings.duplicatePunchSeconds
    );

    if (isDuplicate) {
      logger.warn('Duplicate punch blocked', { memberId });
      await auditLog.duplicatePunchBlocked(req, memberId);
      return res.status(429).json({
        success: false,
        message: 'Recent punch already recorded. Please wait before trying again.',
      });
    }

    // Validate member expiry
    try {
      await attendanceService.validateMemberExpiry(memberId, settings);
    } catch (expiryError) {
      logger.warn('Expired member attempted entry', { memberId });
      await auditLog.expiredMemberBlocked(req, memberId, expiryError.message);
      return res.status(403).json({
        success: false,
        message: expiryError.message,
      });
    }

    // Mark attendance
    const { attendance, isCheckOut } = await attendanceService.markAttendance(memberId);

    // Get member details
    const member = await Member.findById(memberId).lean();

    // Audit log
    await auditLog.attendanceMarked(req, memberId, new Date());

    // Fetch updated member with daysLeft
    const daysLeft = attendanceService.calculateDaysLeft(member.validityEnd);

    res.json({
      success: true,
      message: isCheckOut ? 'Check-out recorded' : 'Check-in recorded',
      attendance,
      member: {
        gymId: member.gymId,
        name: member.fullName,
        plan: member.gymPlan,
        photoUrl: member.photoUrl,
        daysLeft,
        status: daysLeft > 0 ? 'active' : daysLeft === 0 ? 'lastday' : 'expired',
      },
      isCheckOut,
    });
  } catch (error) {
    logger.error('Error marking attendance', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to mark attendance',
      error: error.message,
    });
  }
};

// POST /api/attendance/punch-manual (late punch modal selection)
export const handleLatePunchManual = async (req, res) => {
  try {
    const { memberId, action } = req.body;

    if (!['mark_entry', 'mark_exit', 'cancel'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action',
      });
    }

    if (action === 'cancel') {
      return res.json({
        success: true,
        message: 'Punch cancelled',
      });
    }

    if (action === 'mark_entry') {
      // Mark as check-in only (first punch of day, no checkout)
      const { attendance } = await attendanceService.markAttendance(memberId);
      const member = await Member.findById(memberId).lean();
      const daysLeft = attendanceService.calculateDaysLeft(member.validityEnd);

      await auditLog.attendanceMarked(req, memberId, new Date());

      return res.json({
        success: true,
        message: 'Entry marked',
        attendance,
        member: {
          gymId: member.gymId,
          name: member.fullName,
          daysLeft,
        },
      });
    }

    if (action === 'mark_exit') {
      // Mark as exit only (no entry today, create with checkout only)
      const normalizedDate = new Date();
      normalizedDate.setHours(0, 0, 0, 0);

      const now = new Date();

      // Create attendance with both times (treat as already came and going)
      const attendance = new Attendance({
        memberId,
        date: normalizedDate,
        checkInTime: new Date(normalizedDate.getTime() - 60 * 60 * 1000), // Assume came 1h ago
        checkOutTime: now,
        durationMin: 60,
        state: 'completed',
        source: 'manual',
      });

      await attendance.save();

      const member = await Member.findById(memberId).lean();
      const daysLeft = attendanceService.calculateDaysLeft(member.validityEnd);

      await auditLog.attendanceMarked(req, memberId, new Date());

      return res.json({
        success: true,
        message: 'Exit marked',
        attendance,
        member: {
          gymId: member.gymId,
          name: member.fullName,
          daysLeft,
        },
      });
    }
  } catch (error) {
    logger.error('Error handling late punch', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to handle punch',
      error: error.message,
    });
  }
};

// GET /api/attendance/history/:memberId
export const getAttendanceHistory = async (req, res) => {
  try {
    const { memberId } = req.params;
    const limit = parseInt(req.query.limit) || 30;
    const skip = parseInt(req.query.skip) || 0;

    const records = await Attendance.find({ memberId })
      .sort({ date: -1, checkInTime: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    const total = await Attendance.countDocuments({ memberId });

    res.json({
      success: true,
      total,
      records,
    });
  } catch (error) {
    logger.error('Error fetching attendance history', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance history',
    });
  }
};

// GET /api/attendance/stats/today
export const getTodayStats = async (req, res) => {
  try {
    const stats = await attendanceService.getTodayStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    logger.error('Error fetching today stats', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stats',
    });
  }
};

// ========== CORRECTIONS ENDPOINTS ==========

// PUT /api/attendance/:id/correct-time
export const correctTime = async (req, res) => {
  try {
    const { id } = req.params;
    const { checkInTime, checkOutTime } = req.body;
    const adminId = req.user.id;

    const attendance = await Attendance.findById(id);
    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    if (checkInTime) {
      await attendanceService.correctCheckInTime(id, new Date(checkInTime), adminId);
    }

    if (checkOutTime) {
      await attendanceService.correctCheckOutTime(id, new Date(checkOutTime), adminId);
    }

    await auditLog.attendanceCorrected(req, attendance.memberId, {
      field: checkInTime ? 'checkInTime' : 'checkOutTime',
      newValue: checkInTime || checkOutTime,
    });

    const updated = await Attendance.findById(id).lean();

    res.json({
      success: true,
      message: 'Time corrected',
      attendance: updated,
    });
  } catch (error) {
    logger.error('Error correcting time', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to correct time',
    });
  }
};

// POST /api/attendance/add-missing
export const addMissing = async (req, res) => {
  try {
    const { memberId, date, checkInTime, checkOutTime } = req.body;
    const adminId = req.user.id;

    const attendance = await attendanceService.addMissedAttendance(
      memberId,
      new Date(date),
      new Date(checkInTime),
      checkOutTime ? new Date(checkOutTime) : null,
      adminId
    );

    await auditLog.attendanceMarked(req, memberId, new Date(date));

    res.json({
      success: true,
      message: 'Missed attendance added',
      attendance,
    });
  } catch (error) {
    logger.error('Error adding missing attendance', { error });
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to add attendance',
    });
  }
};

// DELETE /api/attendance/:id
export const deleteAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    const attendance = await Attendance.findById(id);
    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
    }

    await Attendance.deleteOne({ _id: id });

    await auditLog.attendanceDeleted(req, attendance.memberId, id);

    res.json({
      success: true,
      message: 'Attendance record deleted',
    });
  } catch (error) {
    logger.error('Error deleting attendance', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to delete attendance',
    });
  }
};

// GET /api/attendance/search/corrections
export const searchCorrections = async (req, res) => {
  try {
    const { query, type, startDate, endDate } = req.query;

    let filter = {};

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filter.date.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    // If query provided, search by member phone or gymId
    if (query) {
      const member = await Member.findOne({
        $or: [
          { phone: query },
          { gymId: parseInt(query) || null },
        ],
      });

      if (member) {
        filter.memberId = member._id;
      } else {
        return res.json({
          success: true,
          records: [],
          message: 'No member found',
        });
      }
    }

    const records = await Attendance.find(filter)
      .populate('memberId', 'fullName phone gymId')
      .sort({ date: -1, checkInTime: -1 })
      .limit(100)
      .lean();

    res.json({
      success: true,
      records,
    });
  } catch (error) {
    logger.error('Error searching corrections', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to search',
    });
  }
};
