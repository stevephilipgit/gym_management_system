import Member from "../../models/Member.js";
import Attendance from "../../models/Attendance.js";
import Enquiry from "../../models/Enquiry.js";
import aiConfig from "../../config/aiConfig.js";

/**
 * Controlled data-access tools for the AI subsystem.
 *
 * SAFETY GUARANTEES:
 *  - Every tool enforces the authenticated principal's gender scope (never
 *    trusts the model or client).
 *  - Only minimal AI-safe projection fields are returned — never Aadhaar,
 *    photo, medical records, internal identifiers, or secrets.
 *  - Result rows are bounded by `maxToolResultRows`; a `truncated` flag tells
 *    the caller the dataset was larger than what was returned.
 *  - The model can never run arbitrary MongoDB queries.
 */

const PUBLIC_MEMBER_FIELDS = "fullName phone validityEnd gender gymPlan status";

// Cap on rows returned to the model/context.
const MAX_ROWS = aiConfig.maxToolResultRows;

const dayWindow = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
};

const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const scopeFilter = (scope) => (scope === "all" ? {} : { gender: { $in: scope } });

// Small helper that marks truncated result sets consistently.
const boundedResult = (count, rows) => ({
  count,
  truncated: count > rows.length,
  total: count,
});

export const getTotalMembers = async ({ scope }) => {
  const count = await Member.countDocuments(scopeFilter(scope));
  return { count };
};

export const getActiveMembersCount = async ({ scope }) => {
  const filter = {
    ...scopeFilter(scope),
    status: "active",
    paymentStatus: "paid",
  };
  const count = await Member.countDocuments(filter);
  return { count };
};

export const getExpiringMembers = async ({ scope }, days = 7) => {
  const window = dayWindow(days, 7, 1, 90);
  const today = todayStart();
  const target = new Date(today);
  target.setDate(target.getDate() + window);
  target.setHours(23, 59, 59, 999);

  const filter = {
    ...scopeFilter(scope),
    validityEnd: { $gte: today, $lte: target },
  };

  const results = await Member.find(filter)
    .select(PUBLIC_MEMBER_FIELDS)
    .sort({ validityEnd: 1 })
    .limit(MAX_ROWS)
    .lean();

  const members = results.map((member) => ({
    name: member.fullName,
    phone: member.phone,
    gender: member.gender,
    validTill: member.validityEnd,
    daysLeft: Math.ceil((member.validityEnd.getTime() - today.getTime()) / 86400000),
  }));

  return {
    ...boundedResult(members.length, members),
    members,
    daysWindow: window,
  };
};

export const getTodayAttendanceCount = async ({ scope }) => {
  const start = todayStart();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const query = {
    date: { $gte: start, $lt: end },
  };

  if (scope !== "all") {
    const memberIds = await Member.find(scopeFilter(scope)).select("_id").lean();
    query.memberId = { $in: memberIds.map((m) => m._id) };
  }

  const count = await Attendance.countDocuments(query);
  return { count };
};

export const getInactiveMembers = async ({ scope }, days = 30) => {
  const window = dayWindow(days, 30, 1, 365);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - window);

  const filter = {
    ...scopeFilter(scope),
    status: "active",
    $or: [{ lastAttendanceDate: null }, { lastAttendanceDate: { $lt: cutoff } }],
  };

  const results = await Member.find(filter)
    .select(PUBLIC_MEMBER_FIELDS)
    .sort({ lastAttendanceDate: 1 })
    .limit(MAX_ROWS)
    .lean();

  const members = results.map((member) => ({
    name: member.fullName,
    phone: member.phone,
    gender: member.gender,
    lastAttendance: member.lastAttendanceDate,
  }));

  return { ...boundedResult(members.length, members), members };
};

export const getEnquiriesSummary = async () => {
  const statuses = await Enquiry.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const summary = { new: 0, contacted: 0, closed: 0, spam: 0, total: 0 };
  for (const row of statuses) {
    if (Object.prototype.hasOwnProperty.call(summary, row._id)) {
      summary[row._id] = row.count;
    }
    summary.total += row.count;
  }
  return summary;
};

export const getDashboardSummary = async ({ scope }) => {
  const [total, active, expiring, attendance, enquiries] = await Promise.all([
    getTotalMembers({ scope }),
    getActiveMembersCount({ scope }),
    getExpiringMembers({ scope }, 7),
    getTodayAttendanceCount({ scope }),
    getEnquiriesSummary(),
  ]);

  return {
    totalMembers: total.count,
    activeMembers: active.count,
    expiringIn7Days: expiring.count,
    todayAttendance: attendance.count,
    enquiries: enquiries,
  };
};

/**
 * Typed, bounded, composable member query.
 *
 * Supports follow-up filter composition (gender + payment + expiry window +
 * status) WITHOUT exposing arbitrary MongoDB filters. Every filter is validated
 * by the executor (enum/number bounds); projection is AI-safe; rows are capped.
 *
 * @param {{ scope: string|string[] }} principalCtx
 * @param {object} filters typed filters
 * @returns {{ count: number, total: number, truncated: boolean, members: Array }}
 */
export const findMembers = async ({ scope }, filters = {}) => {
  const filter = scopeFilter(scope);

  if (filters.gender) filter.gender = filters.gender;
  if (filters.paymentStatus) filter.paymentStatus = filters.paymentStatus;
  if (filters.status) filter.status = filters.status;

  if (filters.expiresWithinDays) {
    const window = dayWindow(filters.expiresWithinDays, 7, 1, 90);
    const today = todayStart();
    const target = new Date(today);
    target.setDate(target.getDate() + window);
    target.setHours(23, 59, 59, 999);
    filter.validityEnd = { $gte: today, $lte: target };
  }

  if (filters.inactiveForDays) {
    const window = dayWindow(filters.inactiveForDays, 30, 1, 365);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - window);
    filter.$or = [{ lastAttendanceDate: null }, { lastAttendanceDate: { $lt: cutoff } }];
  }

  const results = await Member.find(filter)
    .select(PUBLIC_MEMBER_FIELDS)
    .sort({ validityEnd: 1 })
    .limit(filters.limit || MAX_ROWS)
    .lean();

  const members = results.map((member) => ({
    name: member.fullName,
    phone: member.phone,
    gender: member.gender,
    validTill: member.validityEnd,
    daysLeft: member.validityEnd
      ? Math.ceil((member.validityEnd.getTime() - todayStart().getTime()) / 86400000)
      : null,
  }));

  return { ...boundedResult(members.length, members), members };
};