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
import { performKioskPunch, KioskError } from "../services/kioskService.js";

// Allowed top-level keys for the kiosk punch payload. Anything else is
// rejected (no arbitrary objects, filters, query injection).
const ALLOWED_PAYLOAD_KEYS = new Set(["input", "memberCode", "selectionToken"]);
const MAX_FIELD_LENGTH = 128;

/**
 * Validate the kiosk punch payload strictly.
 * Returns { valid: true } or { valid: false, status, message }.
 */
function validatePunchPayload(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { valid: false, status: 400, message: "Invalid request body." };
  }

  const keys = Object.keys(body);
  const unknown = keys.filter((k) => !ALLOWED_PAYLOAD_KEYS.has(k));
  if (unknown.length > 0) {
    return { valid: false, status: 400, message: "Invalid request body." };
  }

  const modes = ["input", "memberCode", "selectionToken"].filter((k) => body[k] != null && body[k] !== "");
  if (modes.length !== 1) {
    return { valid: false, status: 400, message: "Provide exactly one of input, memberCode, or selectionToken." };
  }

  const value = body[modes[0]];
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_FIELD_LENGTH) {
    return { valid: false, status: 400, message: "Invalid value." };
  }

  return { valid: true, mode: modes[0], value };
}

/**
 * POST /api/attendance/kiosk/punch
 * Auth: X-Kiosk-Id + X-Kiosk-Key headers (kioskAuth middleware)
 */
export const kioskPunch = async (req, res) => {
  const kioskId = req.kiosk?.kioskId;
  const requestMeta = {
    source: "kiosk",
    kioskId,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  };

  const payload = validatePunchPayload(req.body);
  if (!payload.valid) {
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

    if (result && result.status === "ambiguous") {
      attendanceLogger.warn(`Kiosk Ambiguous ID | kiosk=${kioskId} | candidates=${result.candidates?.length}`, requestMeta);
      return res.json(result);
    }

    attendanceLogger.info(`Kiosk Punch OK | kiosk=${kioskId} | member=${result?.member?.gymId} | ${result?.isCheckOut ? "checkout" : "checkin"}`, requestMeta);
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
      return res.status(err.status).json({
        status,
        message: err.message,
        ...err.extra,
      });
    }

    logger.error("Kiosk punch error", { error: err.message, stack: err.stack });
    attendanceLogger.warn(`Kiosk Punch Error | kiosk=${kioskId} | ${err.message}`, requestMeta);
    return res.status(503).json({
      status: "unavailable",
      message: "Member cannot punch at this time. Please contact the gym staff.",
    });
  }
};
