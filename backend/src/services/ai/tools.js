import Member from "../../models/Member.js";
import Attendance from "../../models/Attendance.js";
import Enquiry from "../../models/Enquiry.js";

/**
 * Controlled data-access tools for the AI subsystem.
 *
 * IMPORTANT:
 *  - Every tool enforces the authenticated admin's gender scope (never trusts
 *    the model or client).
 *  - Only minimal projection fields are returned — never Aadhaar, photo,
 *    medical records, or internal identifiers unless required.
 *  - The model can never run arbitrary MongoDB queries.
 */

const PUBLIC_MEMBER_FIELDS = "fullName phone validityEnd gender gymPlan status";

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

export const getTotalMembers = async ({ scope }) => {
  const filter = scope === "all" ? {} : { gender: { $in: scope } };
  const count = await Member.countDocuments(filter);
  return { count };
};

export const getActiveMembersCount = async ({ scope }) => {
  const filter = {
    ...(scope === "all" ? {} : { gender: { $in: scope } }),
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
    ...(scope === "all" ? {} : { gender: { $in: scope } }),
    validityEnd: { $gte: today, $lte: target },
  };

  const results = await Member.find(filter)
    .select(PUBLIC_MEMBER_FIELDS)
    .sort({ validityEnd: 1 })
    .lean();

  const members = results.map((member) => ({
    name: member.fullName,
    phone: member.phone,
    gender: member.gender,
    validTill: member.validityEnd,
    daysLeft: Math.ceil((member.validityEnd.getTime() - today.getTime()) / 86400000),
  }));

  return { count: members.length, members, daysWindow: window };
};

export const getTodayAttendanceCount = async ({ scope }) => {
  const start = todayStart();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const query = {
    date: { $gte: start, $lt: end },
  };

  if (scope !== "all") {
    const memberIds = await Member.find({ gender: { $in: scope } }).select("_id").lean();
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
    ...(scope === "all" ? {} : { gender: { $in: scope } }),
    status: "active",
    $or: [{ lastAttendanceDate: null }, { lastAttendanceDate: { $lt: cutoff } }],
  };

  const results = await Member.find(filter)
    .select(PUBLIC_MEMBER_FIELDS)
    .sort({ lastAttendanceDate: 1 })
    .lean();

  const members = results.slice(0, 20).map((member) => ({
    name: member.fullName,
    phone: member.phone,
    gender: member.gender,
    lastAttendance: member.lastAttendanceDate,
  }));

  return { count: results.length, members };
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