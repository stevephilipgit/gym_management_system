// controllers/kioskController.js - Kiosk attendance punch controller
//
// The ONLY public customer kiosk endpoint. It sits behind kioskAuth and a
// dedicated rate limiter. It authorizes ONLY the kiosk punch operation — it
// never exposes member lists, history, reports, or admin functionality.
//
// Payload contract (exactly ONE identity mode):
//   { input: "192" }            → normal customer path (resolve → punch / ambiguous)
//   { memberCode: "M0192" }     → post-picker exact selection
//   { selectionToken: "..." }   → post-picker selection token

import logger from "../core/logger.js";
import attendanceLogger from "../core/attendanceLogger.js";
import kioskPunchSchema from "../schemas/kioskPunchSchema.js";
import { performKioskPunch, KioskError } from "../services/kioskService.js";

// Identity modes accepted by the public punch endpoint — exactly ONE per request.
const IDENTITY_MODES = ["input", "memberCode", "selectionToken"];

const EXACTLY_ONE_MODE_MESSAGE = "Provide exactly one of input, memberCode, or selectionToken.";

// Joi error types that mean "the right number of identity modes was not given".
const MODE_ISSUE_TYPES = new Set(["object.xor", "object.missing", "object.or", "object.and", "object.nand"]);

/**
 * Joi-driven payload validation (schemas/kioskPunchSchema.js).
 *
 * Runs BEFORE any member resolution, database query or bcrypt work, so a
 * malformed public request can never reach the driver. The response contract
 * consumed by the /kiosk-attendance UI is preserved:
 *   { status: "invalid_payload", message } with HTTP 400.
 *
 * Returns { valid: true, mode, value } or { valid: false, status, message }.
 */
export function validatePunchPayload(body) {
  // Defensive shape gate before Joi: express.json() gives {} for an empty body,
  // but null/undefined/array bodies must never reach Joi's post-checks or the
  // database driver.
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { valid: false, status: 400, message: "Invalid request body." };
  }

  const { error, value } = kioskPunchSchema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const types = error.details.map((d) => d.type);
    const isModeIssue = types.some((t) => MODE_ISSUE_TYPES.has(t));
    const isValueIssue =
      !isModeIssue && types.every((t) => t.startsWith("string.") || t.startsWith("any."));

    return {
      valid: false,
      status: 400,
      message: isModeIssue
        ? EXACTLY_ONE_MODE_MESSAGE
        : isValueIssue
          ? "Invalid value."
          : "Invalid request body.",
    };
  }

  // Exactly one mode present — checked explicitly so the guarantee does not
  // depend on Joi's xor/or semantics across versions.
  const present = IDENTITY_MODES.filter((k) => value[k] !== undefined);
  if (present.length !== 1) {
    return { valid: false, status: 400, message: EXACTLY_ONE_MODE_MESSAGE };
  }

  return { valid: true, mode: present[0], value: value[present[0]] };
}

/**
 * POST /api/attendance/kiosk/punch
 * Auth: X-Kiosk-Id + X-Kiosk-Key headers (kioskAuth middleware)
 */
export const kioskPunch = async (req, res) => {
  const startedAt = Date.now();
  const kioskId = req.kiosk?.kioskId;
  const requestMeta = {
    source: "kiosk",
    kioskId,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  };

  const payload = validatePunchPayload(req.body);
  if (!payload.valid) {
    attendanceLogger.warn(`Kiosk Punch Rejected | kiosk=${kioskId} | reason=invalid_payload`, requestMeta);
    logger.warn("KIOSK_PUNCH_FAILED", {
      kioskId,
      outcome: "invalid_payload",
      reason: payload.message,
      latencyMs: Date.now() - startedAt,
    });
    return res.status(payload.status).json({ status: "invalid_payload", message: payload.message });
  }

  try {
    const result = await performKioskPunch({
      input: payload.mode === "input" ? payload.value : undefined,
      memberCode: payload.mode === "memberCode" ? payload.value : undefined,
      selectionToken: payload.mode === "selectionToken" ? payload.value : undefined,
      scope: req.kiosk?.scope,
      principal: { type: "kiosk", kioskId: req.kiosk?.kioskId },
    });

    const latencyMs = Date.now() - startedAt;

    if (result && result.status === "ambiguous") {
      attendanceLogger.warn(`Kiosk Ambiguous ID | kiosk=${kioskId} | candidates=${result.candidates?.length}`, requestMeta);
      logger.info("KIOSK_PUNCH_SUCCESS", {
        kioskId,
        mode: payload.mode,
        outcome: "ambiguous",
        candidates: result.candidates?.length ?? 0,
        latencyMs,
      });
      return res.json(result);
    }

    attendanceLogger.info(`Kiosk Punch OK | kiosk=${kioskId} | member=${result?.member?.gymId} | ${result?.isCheckOut ? "checkout" : "checkin"}`, requestMeta);
    // Structured success event. NEVER contains the kiosk key, phone number or
    // selection token — only the kiosk identity and non-PII outcome data.
    logger.info("KIOSK_PUNCH_SUCCESS", {
      kioskId,
      mode: payload.mode,
      outcome: result?.isCheckOut ? "check_out" : "check_in",
      isCheckOut: !!result?.isCheckOut,
      isLate: !!result?.isLate,
      memberGymId: result?.member?.gymId ?? null,
      latencyMs,
    });
    return res.json({
      status: "success",
      ...result,
    });
  } catch (err) {
    if (err instanceof KioskError) {
      // Prefer the precise status attached by the service; fall back to a
      // safe generic mapping for unexpected KioskError statuses.
      const status = err.extra?.status || {
        400: "invalid_payload",
        404: "not_found",
        403: "not_eligible",
        409: "already_checked_in",
        429: "rate_limited",
        503: "unavailable",
      }[err.status] || "invalid_payload";

      attendanceLogger.warn(`Kiosk Punch Rejected | kiosk=${kioskId} | status=${err.status} | reason=${err.message}`, requestMeta);
      logger.warn("KIOSK_PUNCH_FAILED", {
        kioskId,
        mode: payload.mode,
        outcome: status,
        reason: err.message,
        latencyMs: Date.now() - startedAt,
      });
      return res.status(err.status).json({
        status,
        message: err.message,
        ...err.extra,
      });
    }

    logger.error("Kiosk punch error", { error: err.message, stack: err.stack });
    attendanceLogger.warn(`Kiosk Punch Error | kiosk=${kioskId} | ${err.message}`, requestMeta);
    logger.error("KIOSK_PUNCH_FAILED", {
      kioskId,
      mode: payload.mode,
      outcome: "unavailable",
      reason: err.message,
      latencyMs: Date.now() - startedAt,
    });
    return res.status(503).json({
      status: "unavailable",
      message: "Member cannot punch at this time. Please contact the gym staff.",
    });
  }
};
