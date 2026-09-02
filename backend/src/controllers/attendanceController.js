import mongoose from 'mongoose';
import crypto from 'crypto';
import attendanceService, { AttendanceStateError } from '../services/attendanceService.js';
import systemSettingsService from '../services/systemSettingsService.js';
import { auditActions } from '../utils/auditLog.js';
import logger from '../core/logger.js';
import attendanceLogger from '../core/attendanceLogger.js';
import { shouldSyncToSheets, syncAttendanceToSheets } from "../services/attendanceSyncService.js";
import scopeResolver from "../core/scopeResolver.js";
import {
  sanitizeInput,
  validateSearchInput,
  isWithinBusinessHours,
  isLateEntry,
  buildPunchResponse,
} from '../utils/attendanceInput.js';

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

// sanitizeInput, validateSearchInput, isWithinBusinessHours, isLateEntry
// are imported from the shared utils/attendanceInput.js module.

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
      // Scope-aware phone lookup: trainers only resolve phones within their
      // allowed genders; out-of-scope members still surface as "not found".
      const allowedGenders = scopeResolver.getScopeAllowedGenders(req);
      const phoneFilter = { phone: value };
      if (allowedGenders.length > 0 && allowedGenders.length < 3) {
        phoneFilter.gender = { $in: allowedGenders };
      }
      member = await Member.findOne(phoneFilter).lean();
    } else if (req.body.memberCode) {
      // Superadmin disambiguation: an explicit memberCode resolves exactly.
      member = await Member.findOne({ gymId: value, memberCode: req.body.memberCode }).lean();
    } else {
      const allowedGenders = scopeResolver.getScopeAllowedGenders(req);
      if (allowedGenders.length > 0 && allowedGenders.length < 3) {
        // Trainer: resolve within authorized scope only. Use find (not findOne)
        // so a duplicate-ID integrity violation is never silently resolved.
        const matches = await Member.find({
          gymId: value,
          gender: { $in: allowedGenders },
        }).select('gymId memberCode fullName gender').lean();
        if (matches.length === 1) {
          member = matches[0];
        } else if (matches.length > 1) {
          // Should be impossible under the shared Female+Transgender numeric
          // sequence. Fail safe: never silently pick one.
          logger.error(`[AttendanceIntegrity] Multiple same-scope members share gymId=${value}`, {
            genders: matches.map((m) => m.gender),
          });
          return res.status(300).json({
            success: false,
            multiple: true,
            integrityViolation: true,
            message: 'Multiple members share this Gym ID within your scope. Contact the gym administrator.',
            members: matches,
          });
        }
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

    // Read-only intent probe: determines check-in vs check-out. The race window
    // between this read and the write is closed by the atomic primitives.
    const existingRecord = await Attendance.findOne({
      memberId: member._id,
      date: normalizedDate,
    });

    let isCheckOut = false;
    let attendance;

    try {
      if (!existingRecord) {
        // SCENARIO A: First entry of day — Check-in (atomic).
        const state = isLate ? 'late' : 'inside';
        const result = await attendanceService.punchIn(member._id, normalizedDate, { state, source });
        attendance = result.attendance;

        if (isLate) {
          attendanceLogger.info(`Late Entry | MemberID=${member.gymId} | Time=${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`, requestMeta);
        } else {
          attendanceLogger.info(`Check-In | MemberID=${member.gymId} | Time=${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} | Status=Inside Gym`, requestMeta);
        }
        await syncAttendanceIfConnected(attendance, member);
      } else if (existingRecord.checkInTime && !existingRecord.checkOutTime) {
        // SCENARIO B: Already inside, entering again — Check-out (atomic).
        isCheckOut = true;
        const result = await attendanceService.punchOut(member._id, normalizedDate);
        attendance = result.attendance;

        attendanceLogger.info(`Check-Out | MemberID=${member.gymId} | Time=${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} | Status=${attendance.state === 'late' ? 'Late' : 'Visited'}`, requestMeta);
        await syncAttendanceIfConnected(attendance, member);
      } else {
        // Already completed today
        attendanceLogger.warn(`Already Completed | MemberID=${member.gymId}`, requestMeta);
        return res.status(409).json({
          success: false,
          message: 'Attendance already completed for today',
        });
      }
    } catch (punchError) {
      if (punchError instanceof AttendanceStateError) {
        // Expected race outcome — return a clean business response, never 500.
        return res.status(punchError.status).json({
          success: false,
          message: punchError.message,
        });
      }
      throw punchError;
    }

    // 9. Build response with full member details (shared shape for PunchModal).
    res.json(buildPunchResponse({ attendance, member, isCheckOut, isLate, daysLeft }));
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

    // Mark attendance (atomic check-in / check-out)
    let attendance;
    let isCheckOut;
    try {
      ({ attendance, isCheckOut } = await attendanceService.markAttendance(memberId));
    } catch (punchError) {
      if (punchError instanceof AttendanceStateError) {
        return res.status(punchError.status).json({
          success: false,
          message: punchError.message,
        });
      }
      throw punchError;
    }

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
      let attendance;
      try {
        ({ attendance } = await attendanceService.markAttendance(memberId));
      } catch (punchError) {
        if (punchError instanceof AttendanceStateError) {
          return res.status(punchError.status).json({
            success: false,
            message: punchError.message,
          });
        }
        throw punchError;
      }
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

      // Atomic create; the unique { memberId, date } index prevents duplicates.
      let attendance;
      try {
        attendance = await Attendance.create({
          memberId,
          date: normalizedDate,
          checkInTime: new Date(normalizedDate.getTime() - 60 * 60 * 1000), // Assume came 1h ago
          checkOutTime: now,
          durationMin: 60,
          state: 'completed',
          source: 'manual',
        });
      } catch (createError) {
        if (createError?.code === 11000) {
          return res.status(409).json({
            success: false,
            message: 'Attendance already recorded for today',
          });
        }
        throw createError;
      }

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

// ── MODE 2: Super Admin scoped attendance ───────────────────────────────

// POST /api/attendance/admin-scope (Super Admin only)
// Issues a short-lived scoped-attendance token bound to an explicitly chosen
// scope ("male" | "female_plus_transgender"). NO "all" scope exists.
export const requestAdminScope = async (req, res) => {
  try {
    const body = req.body;
    const scope = body && typeof body === 'object' && typeof body.scope === 'string' ? body.scope : null;
    if (!["male", "female_plus_transgender"].includes(scope)) {
      return res.status(400).json({ success: false, message: 'Invalid scope. Choose Male or Female + Transgender.' });
    }

    const jwt = await import('jsonwebtoken');
    const config = (await import('../config/index.js')).default;
    const token = jwt.default.sign(
      {
        adminId: String(req.admin.id),
        scope,
        purpose: 'superadmin_attendance',
        jti: crypto.randomUUID(),
      },
      config.jwt.adminAttendanceSecret,
      {
        algorithm: 'HS256',
        issuer: config.jwt.adminAttendanceIssuer,
        audience: config.jwt.adminAttendanceAudience,
        expiresIn: config.jwt.adminAttendanceExpires,
      }
    );

    const expiresInMs = (() => {
      const e = config.jwt.adminAttendanceExpires;
      const m = /^(\d+)m$/.exec(e || '2m');
      const s = /^(\d+)s$/.exec(e || '');
      const h = /^(\d+)h$/.exec(e || '');
      if (h) return parseInt(h[1], 10) * 3600 * 1000;
      if (m) return parseInt(m[1], 10) * 60 * 1000;
      if (s) return parseInt(s[1], 10) * 1000;
      return 2 * 60 * 1000;
    })();

    const auditLog = (await import('../utils/auditLog.js')).auditLog;
    await auditLog(req, {
      action: (await import('../core/constants.js')).ACTION_TYPES.SUPERADMIN_ATTENDANCE_SCOPE_SELECTED,
      status: 'SUCCESS',
      resourceType: 'Attendance',
      resourceId: null,
      changes: { scope },
    });

    return res.json({
      success: true,
      token,
      scope,
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    });
  } catch (error) {
    logger.error('requestAdminScope failed', { error });
    return res.status(500).json({ success: false, message: 'Failed to start attendance session.' });
  }
};

// POST /api/attendance/kiosk/admin-punch (adminAttendanceAuth)
// Super Admin punches using the scope token. Reuses the shared kiosk punch
// business logic with an explicit superadmin principal — NO fake Kiosk doc.
export const adminKioskPunch = async (req, res) => {
  const principal = req.attendancePrincipal;
  const requestMeta = {
    source: 'admin-kiosk',
    adminId: principal.adminId,
    scope: principal.scope,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  };

  // Strict payload validation (reuse the same contract as the public kiosk).
  const { performKioskPunch, KioskError } = await import('../services/kioskService.js');

  const ALLOWED = new Set(['input', 'memberCode', 'selectionToken']);
  const body = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ status: 'invalid_payload', message: 'Invalid request body.' });
  }
  const keys = Object.keys(body);
  if (keys.some((k) => !ALLOWED.has(k))) {
    return res.status(400).json({ status: 'invalid_payload', message: 'Invalid request body.' });
  }
  const modes = ['input', 'memberCode', 'selectionToken'].filter((k) => body[k] != null && body[k] !== '');
  if (modes.length !== 1) {
    return res.status(400).json({ status: 'invalid_payload', message: 'Provide exactly one of input, memberCode, or selectionToken.' });
  }
  const value = body[modes[0]];
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    return res.status(400).json({ status: 'invalid_payload', message: 'Invalid value.' });
  }

  try {
    const result = await performKioskPunch({
      input: modes[0] === 'input' ? value : undefined,
      memberCode: modes[0] === 'memberCode' ? value : undefined,
      selectionToken: modes[0] === 'selectionToken' ? value : undefined,
      scope: principal.scope,
      principal: { type: 'superadmin', adminId: principal.adminId },
    });

    if (result && result.status === 'ambiguous') {
      attendanceLogger.warn(`Admin Kiosk Ambiguous | scope=${principal.scope} | candidates=${result.candidates?.length}`, requestMeta);
      return res.json(result);
    }

    attendanceLogger.info(`Admin Kiosk Punch OK | scope=${principal.scope} | member=${result?.member?.gymId} | ${result?.isCheckOut ? 'checkout' : 'checkin'}`, requestMeta);
    return res.json({ status: 'success', ...result });
  } catch (err) {
    if (err instanceof KioskError) {
      const status = err.extra?.status || {
        400: 'invalid_payload',
        404: 'not_found',
        403: 'not_eligible',
        409: 'already_checked_in',
        429: 'rate_limited',
        503: 'unavailable',
      }[err.status] || 'invalid_payload';
      attendanceLogger.warn(`Admin Kiosk Punch Rejected | scope=${principal.scope} | status=${err.status} | reason=${err.message}`, requestMeta);
      return res.status(err.status).json({ status, message: err.message, ...err.extra });
    }
    logger.error('Admin kiosk punch error', { error: err.message });
    attendanceLogger.warn(`Admin Kiosk Punch Error | scope=${principal.scope} | ${err.message}`, requestMeta);
    return res.status(503).json({ status: 'unavailable', message: 'Member cannot punch at this time. Please contact the gym staff.' });
  }
};
