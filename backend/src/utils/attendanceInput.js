// utils/attendanceInput.js - Shared attendance input sanitization + validation
//
// Single source of truth used by BOTH the admin attendance controller and the
// public kiosk punch path. Keeping this shared guarantees the public kiosk path
// applies exactly the same input rules as the admin counter — no weaker "public"
// variant.

/**
 * Sanitize input - strip dangerous chars, trim, remove all whitespace.
 */
export function sanitizeInput(raw) {
  if (!raw) return "";
  return String(raw)
    .trim()
    .replace(/[<>'"`;\\\/\{\}\[\]\(\)&$!|]/g, "") // strip dangerous chars
    .replace(/\s+/g, ""); // remove all whitespace
}

/**
 * Validate search input - returns { type, value, error }.
 * type is "phone" (10 digits starting 6-9) or "gymId" (positive number).
 */
export function validateSearchInput(input) {
  const sanitized = sanitizeInput(input);

  if (!sanitized) {
    return { type: null, value: null, error: "Please enter a Gym ID or Phone Number" };
  }

  // Must be numeric only
  const digitsOnly = sanitized.replace(/\D/g, "");
  if (digitsOnly.length !== sanitized.length) {
    return { type: null, value: null, error: "Only numeric input allowed" };
  }

  // Phone: exactly 10 digits starting with 6-9
  if (/^[6-9]\d{9}$/.test(digitsOnly)) {
    return { type: "phone", value: digitsOnly, error: null };
  }

  // Reject >10 digits
  if (digitsOnly.length > 10) {
    return { type: null, value: null, error: "Phone must be exactly 10 digits" };
  }

  // Gym ID: min 1 digit, positive integer
  if (digitsOnly.length >= 1) {
    const num = parseInt(digitsOnly, 10);
    if (num <= 0) {
      return { type: null, value: null, error: "Gym ID must be a positive number" };
    }
    return { type: "gymId", value: num, error: null };
  }

  return { type: null, value: null, error: "Invalid input format" };
}

/**
 * Normalize a date to local midnight (start-of-day) — shared by every punch path
 * so the { memberId, date } unique constraint and all day-boundary checks use
 * the exact same definition.
 */
export function normalizeDate(date = new Date()) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

/**
 * Check if current time is within business hours.
 * Shared by the admin counter and the kiosk path — identical rule, no weaker
 * "public" variant.
 */
export function isWithinBusinessHours(openingTime, closingTime, now = new Date()) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [openH, openM] = (openingTime || "04:00").split(":").map(Number);
  const [closeH, closeM] = (closingTime || "22:00").split(":").map(Number);

  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
}

/**
 * Check if current time is after the late-punch threshold.
 * Shared by the admin counter and the kiosk path.
 */
export function isLateEntry(latePunchThreshold, now = new Date()) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [lateH, lateM] = (latePunchThreshold || "21:00").split(":").map(Number);
  const lateMinutes = lateH * 60 + lateM;

  return currentMinutes >= lateMinutes;
}

/**
 * Build the punch success response consumed by PunchModal.jsx.
 * Both the admin searchPunch and the kiosk punch return this exact shape so the
 * frontend never needs a second member lookup.
 *
 * @param {object} params
 * @param {object} params.attendance  Attendance doc (checkInTime, checkOutTime, state, durationMin)
 * @param {object} params.member      Member doc (fullName, gymId, gymPlan, photoUrl, validityEnd, _id)
 * @param {boolean} params.isCheckOut
 * @param {boolean} params.isLate
 * @param {number|null} params.daysLeft
 */
export function buildPunchResponse({ attendance, member, isCheckOut, isLate, daysLeft }) {
  const formatTime = (date) =>
    date
      ? new Date(date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
      : null;
  const formatDate = (date) => (date ? new Date(date).toLocaleDateString("en-GB") : "N/A");

  const statusLabel =
    attendance.state === "late"
      ? "Late"
      : attendance.state === "inside"
        ? "Inside Gym"
        : attendance.state === "completed"
          ? "Visited"
          : attendance.state;

  return {
    success: true,
    message: isCheckOut ? "Check-out successful" : isLate ? "Late Entry recorded" : "Check-in successful",
    isCheckOut,
    isLate: attendance.state === "late",
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
      plan: member.gymPlan,
      photoUrl: member.photoUrl,
      daysLeft,
      status: daysLeft > 0 ? "active" : daysLeft === 0 ? "lastday" : "expired",
      validityEnd: formatDate(member.validityEnd),
    },
    display: {
      checkInTime: formatTime(attendance.checkInTime),
      checkOutTime: formatTime(attendance.checkOutTime),
      statusLabel,
    },
  };
}
