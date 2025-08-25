import mongoose from 'mongoose';
import logger from '../core/logger.js';

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

    // Date N days ago
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - days);
    dateThreshold.setHours(0, 0, 0, 0);

    // Find members who either:
    // 1. Have lastAttendanceDate before threshold
    // 2. Have no lastAttendanceDate
    const members = await Member.find({
      status: 'active',
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

    let filter = {};
    if (status) {
      filter.status = status;
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

    const members = await Member.find({
      status: 'active',
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
 * Helper: Generate attendance CSV
 */
function generateAttendanceCSV(records) {
  if (!records || records.length === 0) {
    return 'Date,Member ID,Name,Phone,Check-in,Check-out,Duration (min),State\n';
  }

  const header =
    'Date,Member ID,Name,Phone,Check-in,Check-out,Duration (min),State\n';

  const rows = records
    .map((r) => {
      const date = r.date ? r.date.toLocaleDateString() : '';
      const memberId = r.memberId?.gymId || '';
      const name = r.memberId?.fullName || '';
      const phone = r.memberId?.phone || '';
      const checkIn = r.checkInTime
        ? r.checkInTime.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
      const checkOut = r.checkOutTime
        ? r.checkOutTime.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
      const duration = r.durationMin || '';
      const state = r.state || '';

      return `"${date}","${memberId}","${name}","${phone}","${checkIn}","${checkOut}","${duration}","${state}"`;
    })
    .join('\n');

  return header + rows;
}

/**
 * Helper: Generate members CSV
 */
function generateMembersCSV(members) {
  if (!members || members.length === 0) {
    return 'Gym ID,Name,Phone,Plan,Days Left,Status,Last Visit\n';
  }

  const header = 'Gym ID,Name,Phone,Plan,Days Left,Status,Last Visit\n';

  const rows = members
    .map((m) => {
      const gymId = m.gymId || '';
      const name = m.fullName || '';
      const phone = m.phone || '';
      const plan = m.gymPlan || '';
      const daysLeft = m.daysLeft !== undefined ? m.daysLeft : '';
      const status = m.status || '';
      const lastVisit = m.lastAttendanceDate
        ? new Date(m.lastAttendanceDate).toLocaleDateString('en-GB')
        : 'Never';

      return `"${gymId}","${name}","${phone}","${plan}","${daysLeft}","${status}","${lastVisit}"`;
    })
    .join('\n');

  return header + rows;
}

/**
 * Helper: Generate inactive members CSV
 */
function generateInactiveCSV(members, days) {
  if (!members || members.length === 0) {
    return `Inactive Members (Not visited in ${days} days)\nGym ID,Name,Phone,Plan,Days Since Visit,Days Left\n`;
  }

  const header = `Inactive Members (Not visited in ${days} days)\nGym ID,Name,Phone,Plan,Days Since Visit,Days Left\n`;

  const rows = members
    .map((m) => {
      const gymId = m.gymId || '';
      const name = m.fullName || '';
      const phone = m.phone || '';
      const plan = m.gymPlan || '';
      const daysSinceVisit = m.daysSinceVisit || 'Never';
      const daysLeft = m.daysLeft !== undefined ? m.daysLeft : '';

      return `"${gymId}","${name}","${phone}","${plan}","${daysSinceVisit}","${daysLeft}"`;
    })
    .join('\n');

  return header + rows;
}
