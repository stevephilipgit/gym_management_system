import mongoose from 'mongoose';
import attendanceService from '../services/attendanceService.js';
import systemSettingsService from '../services/systemSettingsService.js';
import { auditActions } from '../utils/auditLog.js';
import logger from '../core/logger.js';
import attendanceLogger from '../core/attendanceLogger.js';
import { shouldSyncToSheets, syncAttendanceToSheets } from "../services/attendanceSyncService.js";
import scopeResolver from "../core/scopeResolver.js";

const Attendance = mongoose.model('Attendance');
const Member = mongoose.model('Member');

async function syncAttendanceIfConnected(attendanceRecord, memberData) {
  try {
    const canSync = await shouldSyncToSheets();
    if (!canSync) return;
    await syncAttendanceToSheets(attendanceRecord, memberData);
  } catch (syncError) {
    logger.error("Attendance sync failed (non-blocking)", { error: syncError.message });
  }
}

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
    const source = req.get('x-attendance-source') === 'kiosk' ? 'kiosk' : 'counter';
    const requestMeta = {
      source,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };

    attendanceLogger.info(`Search Attempt | Input=${sanitizeInput(rawInput)}`, requestMeta);

    // 1. Validate + sanitize
    const { type, value, error } = validateSearchInput(rawInput);
    if (error) {
      attendanceLogger.warn(`Invalid Search Input | Raw=${sanitizeInput(rawInput)} | Reason=${error}`, requestMeta);
      return res.status(400).json({
        success: false,
        message: error,
      });
    }

    // 2. Find member (scope-aware)
    let member;
    if (type === 'phone') {
      member = await Member.findOne({ phone: value }).lean();
    } else if (req.body.memberCode) {
      // Superadmin disambiguation: an explicit memberCode resolves exactly.
      member = await Member.findOne({ gymId: value, memberCode: req.body.memberCode }).lean();
    } else {
      const allowedGenders = scopeResolver.getScopeAllowedGenders(req);
      if (allowedGenders.length > 0 && allowedGenders.length < 3) {
        // Trainer: resolve within authorized scope only.
        member = await Member.findOne({ gymId: value, gender: { $in: allowedGenders } }).lean();
      } else {
        // Superadmin (all): resolve all matches; never silently pick one.
        const matches = await Member.find({ gymId: value }).select('gymId memberCode fullName gender').lean();
        if (matches.length === 1) {
          member = matches[0];
        } else if (matches.length > 1) {
          return res.status(300).json({
            success: false,
            multiple: true,
            message: 'Multiple members share this Gym ID. Select the member.',
            members: matches,
          });
        }
      }
    }

    if (!member) {
      attendanceLogger.warn(`Member Not Found | Input=${value} | Type=${type}`, requestMeta);
      return res.status(404).json({
        success: false,
        message: 'Member not found',
      });
    }

    // Gender-scope enforcement (server-side). The trainer's scope is derived
    // from the authenticated session only. Out-of-scope members are treated as
    // "not found" so we do not leak whether another gender's member exists.
    if (!scopeResolver.checkMemberScope(req, member.gender)) {
      attendanceLogger.warn(`Member Out of Scope | MemberID=${member.gymId} | Gender=${member.gender}`, requestMeta);
      return res.status(404).json({
        success: false,
        message: 'Member not found',
      });
    }

    attendanceLogger.info(`Member Found | MemberID=${member.gymId} | Name=${member.fullName}`, requestMeta);

    if (member.status !== 'active') {
      attendanceLogger.warn(`Member Blocked by Status | MemberID=${member.gymId} | Status=${member.status}`, requestMeta);
      return res.status(403).json({
        success: false,
        message: `Member is ${member.status}. Attendance not allowed.`,
      });
    }

    // 3. Get settings
    const settings = await systemSettingsService.getSettings();

    // 4. Check business hours
    if (!isWithinBusinessHours(settings.openingTime, settings.closingTime)) {
      attendanceLogger.warn(`Gym Closed Attempt | MemberID=${member.gymId}`, requestMeta);
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
      attendanceLogger.warn(`Expired Member Blocked | MemberID=${member.gymId}`, requestMeta);
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
      attendanceLogger.warn(`Duplicate Punch Blocked | MemberID=${member.gymId}`, requestMeta);
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
        source,
      });
      await attendance.save();

      // Update member lastAttendanceDate
      await Member.updateOne({ _id: member._id }, { lastAttendanceDate: now });

      if (isLate) {
        attendanceLogger.info(`Late Entry | MemberID=${member.gymId} | Time=${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`, requestMeta);
      } else {
        attendanceLogger.info(`Check-In | MemberID=${member.gymId} | Time=${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} | Status=Inside Gym`, requestMeta);
      }
      await syncAttendanceIfConnected(attendance, member);
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

      attendanceLogger.info(`Check-Out | MemberID=${member.gymId} | Time=${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} | Status=${existingRecord.state === 'late' ? 'Late' : 'Visited'}`, requestMeta);
      await syncAttendanceIfConnected(attendance, member);
    } else {
      // Already completed today
      attendanceLogger.warn(`Already Completed | MemberID=${member.gymId}`, requestMeta);
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
    const source = req.get('x-attendance-source') === 'kiosk' ? 'kiosk' : 'counter';
    attendanceLogger.warn(`Search Punch Error | ${error.message}`, {
      source,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.status(500).json({
      success: false,
      message: 'Failed to process attendance',
      error: error.message,
    });
  }
};

/**
 * Attendance Controller - Punch, search logs, and stats
 */

// POST /api/attendance/punch
export const markAttendance = async (req, res) => {
  try {
    const { memberId } = req.body;
    const adminId = req.admin?.id || null;

    // Load member and verify admin scope
    let member = await Member.findById(memberId).select("gender");
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found',
      });
    }

    // Verify admin scope against member gender
    if (!scopeResolver.checkMemberScope(req, member.gender)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: insufficient scope for this member\'s attendance',
      });
    }

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
      await auditActions.duplicatePunchBlocked(req, memberId);
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
      await auditActions.expiredMemberBlocked(req, memberId, expiryError.message);
      return res.status(403).json({
        success: false,
        message: expiryError.message,
      });
    }

    // Mark attendance
    const { attendance, isCheckOut } = await attendanceService.markAttendance(memberId);

    // Get member details
    member = await Member.findById(memberId).lean();
    await syncAttendanceIfConnected(attendance, member);

    // Audit log
    await auditActions.attendanceMarked(req, memberId, new Date());

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

    // Gender-scope enforcement: load the member and verify the trainer is
    // authorized to punch this member.
    let member = null;
    if (memberId && action !== 'cancel') {
      member = await Member.findById(memberId).select("gender gymId fullName validityEnd status");
      if (!member) {
        return res.status(404).json({
          success: false,
          message: 'Member not found',
        });
      }
      if (!scopeResolver.checkMemberScope(req, member.gender)) {
        return res.status(404).json({
          success: false,
          message: 'Member not found',
        });
      }
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
      const daysLeft = attendanceService.calculateDaysLeft(member.validityEnd);
      await syncAttendanceIfConnected(attendance, member);

      await auditActions.attendanceMarked(req, memberId, new Date());

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

      const daysLeft = attendanceService.calculateDaysLeft(member.validityEnd);
      await syncAttendanceIfConnected(attendance, member);

      await auditActions.attendanceMarked(req, memberId, new Date());

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

    // Load member and verify admin scope
    const member = await Member.findById(memberId).select("gender");
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found',
      });
    }

    // Verify admin scope against member gender
    if (!scopeResolver.checkMemberScope(req, member.gender)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: insufficient scope for this member\'s attendance history',
      });
    }

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
    // Gender-scoped: trainers only see counts for their allowed genders.
    // Superadmin (scope=all) sees everything.
    const allowed = scopeResolver.getScopeAllowedGenders(req);
    let stats;
    if (allowed.length === 0 || allowed.length >= 3) {
      stats = await attendanceService.getTodayStats();
    } else {
      const memberIds = await scopeResolver.getScopedMemberIds(req, Member);
      stats = await attendanceService.getTodayStats(memberIds || []);
    }
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

// GET /api/attendance/logs
export const searchAttendanceLogs = async (req, res) => {
  try {
    const { q = '', startDate, endDate, skip = 0, limit = 100 } = req.query;
    const parsedLimit = Math.min(parseInt(limit, 10) || 100, 500);
    const parsedSkip = Math.max(parseInt(skip, 10) || 0, 0);

    const attendanceFilter = {};
    if (startDate || endDate) {
      attendanceFilter.date = {};

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        attendanceFilter.date.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        attendanceFilter.date.$lte = end;
      }
    }

    const memberFilter = {};
    const allowedGenders = scopeResolver.getScopeAllowedGenders(req);

    if (allowedGenders.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: invalid admin scope',
      });
    }

    memberFilter.gender = { $in: allowedGenders };

    const search = String(q).trim();
    if (search) {
      const digitsOnly = search.replace(/\D/g, '');
      const searchTerms = [
        { fullName: { $regex: search, $options: 'i' } },
        { phone: { $regex: digitsOnly || search, $options: 'i' } },
      ];

      if (digitsOnly) {
        searchTerms.push({ gymId: Number(digitsOnly) });
      }

      memberFilter.$or = searchTerms;
    }

    const matchingMembers = await Member.find(memberFilter).select('_id').lean();
    const memberIds = matchingMembers.map((member) => member._id);

    if (memberIds.length === 0) {
      return res.json({
        success: true,
        total: 0,
        count: 0,
        records: [],
      });
    }

    attendanceFilter.memberId = { $in: memberIds };

    const [records, total] = await Promise.all([
      Attendance.find(attendanceFilter)
        .populate('memberId', 'gymId fullName phone gender gymPlan validityEnd status')
        .sort({ date: -1, checkInTime: -1 })
        .skip(parsedSkip)
        .limit(parsedLimit)
        .lean(),
      Attendance.countDocuments(attendanceFilter),
    ]);

    res.json({
      success: true,
      total,
      count: records.length,
      records,
    });
  } catch (error) {
    logger.error('Error searching attendance records', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to search attendance records',
    });
  }
};
