import Member from "../../models/Member.js";
import { prepareRemindersWithMessages } from "./reminderService.js";

const cleanToolError = (message) => {
  throw new Error(message);
};

export const getTotalMembers = async () => {
  try {
    const count = await Member.countDocuments({});
    return { count, label: "Total Members" };
  } catch {
    cleanToolError("Unable to fetch total members");
  }
};

export const getExpiringMembers = async (days = 7) => {
  const normalizedDays = Number(days);

  if (!Number.isInteger(normalizedDays) || normalizedDays < 1 || normalizedDays > 90) {
    throw new Error("days must be a number between 1 and 90");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDate = new Date(today);
  targetDate.setDate(targetDate.getDate() + normalizedDays);
  targetDate.setHours(23, 59, 59, 999);

  try {
    const results = await Member.find({
      validityEnd: { $gte: today, $lte: targetDate },
    })
      .select("fullName phone validityEnd")
      .sort({ validityEnd: 1 })
      .lean();

    const members = results.map((member) => ({
      name: member.fullName,
      email: null,
      phone: member.phone,
      validTill: member.validityEnd,
    }));

    return { count: members.length, members, daysWindow: normalizedDays };
  } catch {
    cleanToolError("Unable to fetch expiring members");
  }
};

export const sendReminder = async (members) => {
  if (!Array.isArray(members)) {
    throw new Error("sendReminder requires an array of members");
  }

  if (members.length === 0) {
    throw new Error("No members provided to sendReminder");
  }

  if (members.length > 50) {
    throw new Error("Cannot process more than 50 members at once");
  }

  return prepareRemindersWithMessages(members);
};
