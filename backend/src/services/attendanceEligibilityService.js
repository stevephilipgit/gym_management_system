// services/attendanceEligibilityService.js - Centralized attendance eligibility policy
//
// Canonical source of truth for "may this exact member punch right now?".
// The kiosk punch path is the first mandatory consumer; future customer punch
// paths must use this same policy. It owns:
//   - member existence
//   - active status
//   - validity / expiry / grace (fail-closed on missing validityEnd)
//   - business hours
//   - duplicate-punch window
//   - attendance state decision (check-in / check-out / already completed)
//   - late-state decision
//
// It returns a STRUCTURED outcome — never raw DB errors. It does NOT execute
// the punch; the caller (kioskService) performs the atomic punchIn/punchOut.
//
// Admin attendance behavior is intentionally NOT changed in this release.

import mongoose from "mongoose";
import logger from "../core/logger.js";
import attendanceService from "./attendanceService.js";
import {
  isWithinBusinessHours,
  isLateEntry,
  normalizeDate,
} from "../utils/attendanceInput.js";

const Member = mongoose.model("Member");
const Attendance = mongoose.model("Attendance");

// Fail-closed validity: a missing/malformed validityEnd is NOT eligible unless
// an explicit business exception is approved. This prevents incomplete
// membership validity from accidentally failing open.
const FAIL_CLOSED_VALIDITY = true;

/**
 * Evaluate whether `member` may punch at this moment.
 *
 * @param {object} member   Freshly loaded Member document (must be current).
 * @param {object} settings Current SystemSettings (business rules).
 * @param {Date}   [now]    Overridable clock for tests.
 * @returns {Promise<{
 *   status: "check_in" | "check_out" | "already_completed" | "invalid_member"
 *           | "inactive" | "expired" | "closed" | "duplicate",
 *   member, daysLeft, isLate, openingTime, closingTime
 * }>}
 */
export async function evaluatePunchEligibility(member, settings, now = new Date()) {
  // 1. Member existence — always fresh at punch time.
  if (!member || !member._id) {
    return { status: "invalid_member", member: null, daysLeft: null, isLate: false };
  }

  // 2. Active status.
  if (member.status !== "active") {
    return { status: "inactive", member, daysLeft: null, isLate: false };
  }

  // 3. Validity / expiry with grace (fail-closed on missing/malformed validityEnd).
  const daysLeft = attendanceService.calculateDaysLeft(member.validityEnd);
  if (FAIL_CLOSED_VALIDITY && member.validityEnd == null) {
    return { status: "expired", member, daysLeft: null, isLate: false };
  }
  if (FAIL_CLOSED_VALIDITY && !Number.isFinite(daysLeft)) {
    return { status: "expired", member, daysLeft: null, isLate: false };
  }
  if (daysLeft < -settings.expiredGraceDays && settings.blockExpiredMembers) {
    return { status: "expired", member, daysLeft, isLate: false };
  }

  // 4. Business hours.
  if (!isWithinBusinessHours(settings.openingTime, settings.closingTime, now)) {
    return {
      status: "closed",
      member,
      daysLeft,
      isLate: false,
      openingTime: settings.openingTime || "04:00",
      closingTime: settings.closingTime || "22:00",
    };
  }

  // 5. Duplicate-punch window.
  const isDuplicate = await attendanceService.checkDuplicate(
    member._id,
    now,
    settings.duplicatePunchSeconds
  );
  if (isDuplicate) {
    return { status: "duplicate", member, daysLeft, isLate: false };
  }

  // 6. Attendance state decision (check-in / check-out / already completed).
  const normalizedDate = normalizeDate(now);
  const existing = await Attendance.findOne({ memberId: member._id, date: normalizedDate });

  if (!existing) {
    // First entry of the day → check-in.
    const isLate = isLateEntry(settings.latePunchThreshold, now);
    return { status: "check_in", member, daysLeft, isLate };
  }

  if (existing.checkInTime && !existing.checkOutTime) {
    // Already inside → check-out.
    return { status: "check_out", member, daysLeft, isLate: false };
  }

  // Already completed today.
  return { status: "already_completed", member, daysLeft, isLate: false };
}

/**
 * Convenience wrapper: load the CURRENT member by _id and evaluate eligibility.
 * Guarantees fresh authoritative data at punch time (never a resolve snapshot).
 *
 * @param {string} memberId
 * @param {object} settings
 * @param {Date}   [now]
 */
export async function evaluateMemberPunch(memberId, settings, now = new Date()) {
  if (!mongoose.isValidObjectId(memberId)) {
    return { status: "invalid_member", member: null, daysLeft: null, isLate: false };
  }
  const member = await Member.findById(memberId).lean();
  if (!member) {
    logger.warn("Kiosk punch: member not found at punch time", { memberId });
    return { status: "invalid_member", member: null, daysLeft: null, isLate: false };
  }
  return evaluatePunchEligibility(member, settings, now);
}
