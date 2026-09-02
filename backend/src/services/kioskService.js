// services/kioskService.js - Kiosk attendance punch orchestration
//
// Shared customer kiosk flow. One trusted device serves Male, Female and
// Transgender customers. The kiosk is a TRUSTED DEVICE only — it carries no
// customer gender/scope. Customer identity is resolved at punch time:
//
//   { input }          → numeric Gym ID / phone → 0 / 1 / many
//   { memberCode }     → post-picker exact selection (unique, server-resolved)
//   { selectionToken } → post-picker selection token (short-lived, kiosk-bound,
//                        server-issued during the ambiguous response)
//
// It reuses:
//   - attendanceEligibilityService (centralized eligibility policy)
//   - attendanceService.punchIn / punchOut (atomic primitives)
//   - systemSettingsService (shared configuration)
//   - utils/attendanceInput.js (input validation + response building)
//
// This service never references req.admin or admin roles.

import mongoose from "mongoose";
import crypto from "crypto";
import logger from "../core/logger.js";
import attendanceService, { AttendanceStateError } from "./attendanceService.js";
import { evaluateMemberPunch } from "./attendanceEligibilityService.js";
import systemSettingsService from "./systemSettingsService.js";
import { validateSearchInput, normalizeDate, buildPunchResponse } from "../utils/attendanceInput.js";
import { shouldSyncToSheets, syncAttendanceToSheets } from "./attendanceSyncService.js";
import config from "../config/index.js";
import { GENDERS_FOR_SCOPE } from "./deviceRegistrationService.js";

const Attendance = mongoose.model("Attendance");
const Member = mongoose.model("Member");

/**
 * Controlled kiosk error — carries a safe HTTP status and message that the
 * controller can return directly. Never exposes stack, schema, or existence
 * details across gyms/genders.
 */
export class KioskError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
    this.name = "KioskError";
  }
}

// ── Selection token ─────────────────────────────────────────────────────────
// Short-lived signed token issued when an ambiguous Gym ID is found. Bound to
// the issuing kiosk + exact Member._id + expiry. It does NOT grant attendance
// permission — it only identifies which candidate the customer selected.
// The server re-loads the current Member and runs eligibility at punch time.
const SELECTION_TOKEN_TTL_MS = 2 * 60 * 1000; // 2 minutes

function issueSelectionToken({ kioskId, memberId }) {
  const payload = {
    kind: "kiosk_selection",
    kioskId,
    memberId: String(memberId),
    iat: Date.now(),
    exp: Date.now() + SELECTION_TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", config.jwt.accessSecret)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifySelectionToken(token, kioskId) {
  try {
    if (typeof token !== "string" || !token.includes(".")) return null;
    const [body, sig] = token.split(".");
    const expected = crypto
      .createHmac("sha256", config.jwt.accessSecret)
      .update(body)
      .digest("base64url");
    // Timing-safe compare.
    const a = Buffer.from(sig || "");
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.kind !== "kiosk_selection") return null;
    if (payload.kioskId !== kioskId) return null; // bound to the issuing kiosk
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null; // expired
    if (!mongoose.isValidObjectId(payload.memberId)) return null;
    return { memberId: payload.memberId, kioskId: payload.kioskId };
  } catch {
    return null;
  }
}

// ── Safe candidate DTO ──────────────────────────────────────────────────────
// Whitelisted fields only — never the full Member document. No Aadhaar,
// medical issues, address, fatherName, phone, or internal DB ids.

const SAFE_CANDIDATE_FIELDS = ["fullName", "memberCode", "gender", "gymId"];

function buildSafeCandidate(member) {
  return {
    fullName: member.fullName,
    memberCode: member.memberCode || null,
    gender: member.gender,
    gymId: member.gymId,
  };
}

// Female and Transgender share ONE numeric sequence (F counter). Two members
// with the same gymId BOTH in the Female/Transgender group is a data-integrity
// violation, not a normal collision.
function isSameSequenceIntegrityViolation(matches) {
  const fOrT = matches.filter((m) => m.gender === "Female" || m.gender === "Transgender");
  return fOrT.length > 1;
}

/**
 * Resolve a Gym ID / phone input within the DEVICE's scope.
 *
 * Phase 4: the physical device carries a fixed server-controlled scope. A Male
 * device only ever resolves Male members; a Female/T device only resolves
 * Female + Transgender. A member outside the device scope is indistinguishable
 * from "not found" (no cross-gender leakage).
 *
 * @param {string} input  raw gym-id or phone
 * @param {string} [scope] device scope from the parent Kiosk ("male" |
 *                         "female_plus_transgender"); when absent, all genders
 *                         are searched (legacy/no-scope path only)
 * @returns {Promise<{ type: string, value, matches: object[] }>}
 * @throws {KioskError}
 */
async function resolveMembersByInput(input, scope) {
  const { type, value, error } = validateSearchInput(input);
  if (error) {
    throw new KioskError(400, "Invalid input. Enter Gym ID or Phone Number.");
  }

  const allowedGenders = scope ? GENDERS_FOR_SCOPE[scope] || null : null;

  let matches;
  if (type === "phone") {
    // Phone is globally unique — resolve directly, then verify the member is
    // within the device scope. Out-of-scope phone → not found (no leak).
    const member = await Member.findOne({ phone: value }).lean();
    matches = member ? (allowedGenders && !allowedGenders.includes(member.gender) ? [] : [member]) : [];
  } else {
    // gymId is only unique within a gender. Search WITHIN the device scope so
    // legitimate cross-gym collisions (Male 192 + Female 192) never mix on one
    // physical device. Indexed ({gymId, gender} compound unique).
    const filter = { gymId: value };
    if (allowedGenders) {
      filter.gender = { $in: allowedGenders };
    }
    matches = await Member.find(filter).lean();
  }

  return { type, value, matches };
}

/**
 * Determine the resolution outcome for an input within the device scope.
 *
 * Scoped device (Phase 4): >1 matches within one scope is ALWAYS a
 * data-integrity violation (Female + Transgender same number, or corrupt
 * duplicates). A physical device's scope isolates the gender population, so no
 * picker is needed and none is ever shown.
 *
 * Legacy no-scope device (pre-Phase-4 records, not yet migrated): all genders
 * are searched, so Male + Female ambiguity is still possible and uses the safe
 * picker. This path is retained only until legacy records are reconciled.
 *
 * @returns {Promise<{
 *   status: "not_found" | "ambiguous" | "integrity_error" | "punchable",
 *   member?, matches?, candidates?, integrity?: boolean
 * }>}
 */
async function resolveForInput(input, kioskId, scope) {
  const { type, value, matches } = await resolveMembersByInput(input, scope);

  if (matches.length === 0) {
    return { status: "not_found", type, value };
  }

  if (matches.length === 1) {
    return { status: "punchable", type, value, member: matches[0] };
  }

  // >1 matches WITHIN one device scope → integrity violation (fail safe).
  if (scope) {
    logger.error(`[KioskIntegrity] Same numeric sequence collision for gymId=${value}`, {
      genders: matches.map((m) => m.gender),
      kioskId,
      scope,
    });
    return { status: "integrity_error", type, value, matches };
  }

  // ── Legacy no-scope path (all genders searched) ──────────────────────────
  //   - Female + Transgender same number  → integrity violation (fail safe)
  //   - Male + Female / any other mix     → legitimate ambiguity → safe picker
  if (isSameSequenceIntegrityViolation(matches)) {
    logger.error(`[KioskIntegrity] Same numeric sequence collision for gymId=${value}`, {
      genders: matches.map((m) => m.gender),
      kioskId,
    });
    return { status: "integrity_error", type, value, matches };
  }

  // Cap candidates — never return an unbounded list even on corrupt data.
  const MAX_KIOSK_CANDIDATES = 5;
  if (matches.length > MAX_KIOSK_CANDIDATES) {
    logger.error(`[KioskIntegrity] Candidate count exceeds cap for gymId=${value}`, {
      count: matches.length,
      kioskId,
    });
    return { status: "integrity_error", type, value, matches };
  }

  const candidates = matches.map((m) => ({
    ...buildSafeCandidate(m),
    selectionToken: issueSelectionToken({ kioskId, memberId: m._id }),
  }));

  return { status: "ambiguous", type, value, candidates };
}

/**
 * Execute the atomic punch for an exact, freshly-loaded member.
 * Runs eligibility against CURRENT member state and atomic punchIn/punchOut.
 *
 * @param {object} member  current Member doc
 * @param {Date}   [now]   clock override for deterministic tests
 * @returns {Promise<object>} buildPunchResponse payload
 * @throws {KioskError} on ineligible / duplicate / already-completed states
 */
async function executePunchForMember(member, now = new Date()) {
  const settings = await systemSettingsService.getSettings();
  const outcome = await evaluateMemberPunch(member._id, settings, now);

  switch (outcome.status) {
    case "invalid_member":
      throw new KioskError(404, "Member not found.", { status: "invalid_member" });
    case "inactive":
    case "expired":
      throw new KioskError(403, "Member cannot punch at this time.", { status: "not_eligible" });
    case "closed":
      throw new KioskError(403, `Gym is closed. Operating hours: ${outcome.openingTime} AM - ${outcome.closingTime} PM`, {
        status: "gym_closed",
        gymClosed: true,
        openingTime: outcome.openingTime,
        closingTime: outcome.closingTime,
      });
    case "duplicate":
      throw new KioskError(429, "Recent punch already recorded. Please wait.", { status: "rate_limited" });
    case "already_completed":
      throw new KioskError(409, "Attendance already recorded.", { status: "already_checked_out" });
    case "check_in":
    case "check_out":
      break;
    default:
      throw new KioskError(503, "Member cannot punch at this time. Please contact the gym staff.", { status: "unavailable" });
  }

  const normalizedDate = normalizeDate(now);

  let attendance;
  let isCheckOut = false;
  try {
    if (outcome.status === "check_in") {
      const state = outcome.isLate ? "late" : "inside";
      const result = await attendanceService.punchIn(member._id, normalizedDate, {
        state,
        source: "kiosk",
      });
      attendance = result.attendance;
    } else {
      isCheckOut = true;
      const result = await attendanceService.punchOut(member._id, normalizedDate);
      attendance = result.attendance;
    }
  } catch (punchError) {
    if (punchError instanceof AttendanceStateError) {
      // Expected race: another request already performed this transition.
      const status = isCheckOut ? "already_checked_out" : "already_checked_in";
      throw new KioskError(punchError.status, "Attendance already recorded.", { status });
    }
    logger.error("Kiosk punch atomic operation failed", { error: punchError.message });
    throw new KioskError(503, "Member cannot punch at this time. Please contact the gym staff.", { status: "unavailable" });
  }

  // Non-blocking Google Sheets sync (legacy, best-effort).
  try {
    const canSync = await shouldSyncToSheets();
    if (canSync) {
      await syncAttendanceToSheets(attendance, member);
    }
  } catch (syncError) {
    logger.warn("Kiosk attendance sync to sheets failed (non-blocking)", {
      error: syncError.message,
    });
  }

  return buildPunchResponse({
    attendance,
    member,
    isCheckOut,
    isLate: outcome.status === "check_in" && outcome.isLate,
    daysLeft: outcome.daysLeft,
  });
}

/**
 * Perform a kiosk punch via one of three identity modes (exactly one supplied).
 *
 * The caller supplies a server-derived `scope` and a `principal` describing the
 * authenticated attendance context:
 *   - MODE 1 (Trainer device): kioskAuth attaches req.kiosk → principal type
 *     "kiosk" with the physical kioskId.
 *   - MODE 2 (Super Admin): adminAttendanceAuth attaches req.attendancePrincipal
 *     → principal type "superadmin" with the Super Admin's adminId.
 *
 * No synthetic Kiosk DB document is fabricated for Super Admin; the same scope-
 * bound member resolution + attendance business logic is reused for both.
 *
 * @param {object} params
 * @param {string} [params.input]           raw gym-id/phone (normal customer path)
 * @param {string} [params.memberCode]      post-picker exact selection
 * @param {string} [params.selectionToken]  post-picker selection token
 * @param {string} params.scope             server-authoritative scope ("male" |
 *                                          "female_plus_transgender")
 * @param {object} params.principal         { type, kioskId?|adminId }
 * @returns {Promise<object>} response payload
 */
export async function performKioskPunch({ input, memberCode, selectionToken, scope, principal, now }) {
  // Principal identity used to bind selection tokens (stable per attendance
  // context). kioskId for trainer devices; adminId for Super Admin.
  const principalId = principal?.type === "superadmin" ? `superadmin:${principal.adminId}` : principal?.kioskId || null;
  const allowedGenders = scope ? GENDERS_FOR_SCOPE[scope] || null : null;
  const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();

  // A member within the device scope? (defense-in-depth on exact paths)
  const inScope = (member) =>
    !allowedGenders || (member && allowedGenders.includes(member.gender));

  // ── Mode: selection token ─────────────────────────────────────────────────
  if (selectionToken) {
    const token = verifySelectionToken(selectionToken, principalId);
    if (!token) {
      throw new KioskError(400, "Invalid selection. Please try again.");
    }
    const member = await Member.findById(token.memberId).lean();
    if (!member || !inScope(member)) {
      throw new KioskError(404, "Member not found.");
    }
    return executePunchForMember(member, clock);
  }

  // ── Mode: memberCode (post-picker exact selection) ────────────────────────
  if (memberCode) {
    const member = await Member.findOne({ memberCode }).lean();
    if (!member || !inScope(member)) {
      throw new KioskError(404, "Member not found.");
    }
    return executePunchForMember(member, clock);
  }

  // ── Mode: input (normal customer path — resolve then act) ─────────────────
  if (input) {
    const resolution = await resolveForInput(input, principalId, scope);

    switch (resolution.status) {
      case "not_found":
        throw new KioskError(404, "Member not found.", { status: "not_found" });
      case "integrity_error":
        throw new KioskError(409, "Member cannot punch at this time. Please contact the gym staff.", { status: "integrity_error" });
      case "ambiguous":
        // Legacy no-scope path only (device without a scope). A scoped device
        // never returns ambiguous — scope isolates the gender population.
        return {
          status: "ambiguous",
          message: "Who are you?",
          candidates: resolution.candidates,
        };
      case "punchable":
        return executePunchForMember(resolution.member, clock);
      default:
        throw new KioskError(503, "Member cannot punch at this time. Please contact the gym staff.", { status: "unavailable" });
    }
  }

  throw new KioskError(400, "Invalid request. Provide input, memberCode, or selectionToken.");
}
