import mongoose from 'mongoose';
import logger from '../core/logger.js';
import scopeResolver from '../core/scopeResolver.js';
import { toCsv, toCsvLine } from '../utils/csvSafety.js';

const Member = mongoose.model('Member');
const Attendance = mongoose.model('Attendance');

/**
 * Reports Controller - Inactivity reports and exports
 */

// GET /api/reports/inactive
export const getInactiveMembers = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const skip = parseInt(req.query.skip) || 0;
    const limit = parseInt(req.query.limit) || 50;

    // Gender-scope enforcement (centralized via scopeResolver).
    const genderFilter = scopeResolver.buildGenderFilter(req);

    // Date N days ago
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - days);
    dateThreshold.setHours(0, 0, 0, 0);

    // Find members who either:
    // 1. Have lastAttendanceDate before threshold
    // 2. Have no lastAttendanceDate
    const members = await Member.find({
      status: 'active',
      ...genderFilter,
      $or: [
        { lastAttendanceDate: { $lt: dateThreshold } },
        { lastAttendanceDate: null },
      ],
    })
      .select(
        'gymId fullName phone validityEnd gymPlan lastAttendanceDate status'
      )
      .sort({ lastAttendanceDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Member.countDocuments({
      status: 'active',
      ...genderFilter,
      $or: [
        { lastAttendanceDate: { $lt: dateThreshold } },
        { lastAttendanceDate: null },
      ],
    });

    // Add daysLeft and daysSinceVisit
    const enhanced = members.map((m) => {
      const daysLeft = m.validityEnd
        ? Math.ceil(
            (new Date(m.validityEnd) - new Date()) / (1000 * 60 * 60 * 24)
          )
        : null;

      const daysSinceVisit = m.lastAttendanceDate
        ? Math.floor((new Date() - new Date(m.lastAttendanceDate)) / (1000 * 60 * 60 * 24))
        : 'Never';

      return {
        ...m,
        daysLeft,
        daysSinceVisit,
      };
    });

    res.json({
      success: true,
      days,
      total,
      count: enhanced.length,
      members: enhanced,
    });
  } catch (error) {
    logger.error('Error fetching inactive members', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inactive members',
    });
  }
};

// GET /api/reports/export/attendance
export const exportAttendanceCSV = async (req, res) => {
  try {
    const { startDate, endDate, skip = 0, limit = 5000 } = req.query;

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

    // Gender-scope enforcement: trainers may only export attendance belonging
    // to their allowed genders. Superadmin (all) is unrestricted.
    const allowedGenders = scopeResolver.getScopeAllowedGenders(req);
    if (allowedGenders.length > 0 && allowedGenders.length < 3) {
      const memberIds = await scopeResolver.getScopedMemberIds(req, Member);
      if (!memberIds || memberIds.length === 0) {
        return res.send(generateAttendanceCSV([]));
      }
      filter.memberId = { $in: memberIds };
    }

    const records = await Attendance.find(filter)
      .populate('memberId', 'fullName phone gymId')
      .sort({ date: -1, checkInTime: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .lean();

    // Generate CSV
    const csv = generateAttendanceCSV(records);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
    res.send(csv);

    logger.info('Attendance CSV exported', { recordCount: records.length });
  } catch (error) {
    logger.error('Error exporting attendance CSV', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to export attendance',
    });
  }
};

// GET /api/reports/export/members
export const exportMembersCSV = async (req, res) => {
  try {
    const { status, skip = 0, limit = 5000 } = req.query;

    // Gender-scope enforcement (centralized via scopeResolver).
    const genderFilter = scopeResolver.buildGenderFilter(req);

    let filter = {};
    if (status) {
      filter.status = status;
    }

    // Apply gender scope filter (no-op for superadmin/all)
    if (genderFilter.gender) {
      filter.gender = genderFilter.gender;
    }

    const members = await Member.find(filter)
      .select(
        'gymId fullName phone email gender validityEnd gymPlan status lastAttendanceDate'
      )
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .lean();

    // Add daysLeft to each
    const enhanced = members.map((m) => ({
      ...m,
      daysLeft: m.validityEnd
        ? Math.ceil(
            (new Date(m.validityEnd) - new Date()) / (1000 * 60 * 60 * 24)
          )
        : null,
    }));

    const csv = generateMembersCSV(enhanced);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="members.csv"');
    res.send(csv);

    logger.info('Members CSV exported', { memberCount: enhanced.length });
  } catch (error) {
    logger.error('Error exporting members CSV', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to export members',
    });
  }
};

// GET /api/reports/export/inactive
export const exportInactiveReport = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const skip = parseInt(req.query.skip) || 0;
    const limit = parseInt(req.query.limit) || 5000;

    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - days);
    dateThreshold.setHours(0, 0, 0, 0);

    // Gender-scope enforcement (same rule as getInactiveMembers).
    const genderFilter = scopeResolver.buildGenderFilter(req);

    const members = await Member.find({
      status: 'active',
      ...genderFilter,
      $or: [
        { lastAttendanceDate: { $lt: dateThreshold } },
        { lastAttendanceDate: null },
      ],
    })
      .select(
        'gymId fullName phone validityEnd gymPlan lastAttendanceDate status'
      )
      .sort({ lastAttendanceDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const enhanced = members.map((m) => ({
      ...m,
      daysSinceVisit: m.lastAttendanceDate
        ? Math.floor(
            (new Date() - new Date(m.lastAttendanceDate)) / (1000 * 60 * 60 * 24)
          )
        : 'Never',
      daysLeft: m.validityEnd
        ? Math.ceil(
            (new Date(m.validityEnd) - new Date()) / (1000 * 60 * 60 * 24)
          )
        : null,
    }));

    const csv = generateInactiveCSV(enhanced, days);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="inactive-${days}days.csv"`
    );
    res.send(csv);

    logger.info('Inactive report CSV exported', {
      days,
      memberCount: enhanced.length,
    });
  } catch (error) {
    logger.error('Error exporting inactive report', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to export report',
    });
  }
};

/**
 * Helper: Generate attendance CSV (admin on-demand export).
 * Uses the shared safe CSV writer (RFC-4180 + injection protection).
 * Keeps the historical admin schema (includes Phone — admin-only context).
 */
function generateAttendanceCSV(records) {
  const header = [
    'Date',
    'Member ID',
    'Name',
    'Phone',
    'Check-in',
    'Check-out',
    'Duration (min)',
    'State',
  ];

  const rows = (records || []).map((r) => [
    r.date ? r.date.toLocaleDateString() : '',
    r.memberId?.gymId || '',
    r.memberId?.fullName || '',
    r.memberId?.phone || '',
    r.checkInTime
      ? r.checkInTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : '',
    r.checkOutTime
      ? r.checkOutTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : '',
    r.durationMin || '',
    r.state || '',
  ]);

  return toCsv(header, rows);
}

/**
 * Helper: Generate members CSV (admin on-demand export).
 * Uses the shared safe CSV writer.
 */
function generateMembersCSV(members) {
  const header = ['Gym ID', 'Name', 'Phone', 'Plan', 'Days Left', 'Status', 'Last Visit'];

  const rows = (members || []).map((m) => [
    m.gymId || '',
    m.fullName || '',
    m.phone || '',
    m.gymPlan || '',
    m.daysLeft !== undefined ? m.daysLeft : '',
    m.status || '',
    m.lastAttendanceDate
      ? new Date(m.lastAttendanceDate).toLocaleDateString('en-GB')
      : 'Never',
  ]);

  return toCsv(header, rows);
}

/**
 * Helper: Generate inactive members CSV (admin on-demand export).
 * Uses the shared safe CSV writer.
 */
function generateInactiveCSV(members, days) {
  const header = [
    `Inactive Members (Not visited in ${days} days)`,
    'Gym ID',
    'Name',
    'Phone',
    'Plan',
    'Days Since Visit',
    'Days Left',
  ];

  const rows = (members || []).map((m) => [
    '',
    m.gymId || '',
    m.fullName || '',
    m.phone || '',
    m.gymPlan || '',
    m.daysSinceVisit || 'Never',
    m.daysLeft !== undefined ? m.daysLeft : '',
  ]);

  return toCsv(header, rows);
}
