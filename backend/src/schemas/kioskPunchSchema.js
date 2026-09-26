// schemas/kioskPunchSchema.js - Strict payload contract for the PUBLIC kiosk punch
//
// The kiosk punch is the only public write surface in the app, so the body is
// validated with Joi BEFORE any member resolution, database query, or bcrypt
// work. The contract is deliberately tiny:
//   - exactly ONE identity mode: input | memberCode | selectionToken
//   - string values only, trimmed, 1..128 chars (bounds every indexed lookup)
//   - unknown keys rejected outright (no filters, operators, or nested objects)
import Joi from "joi";

const identityValue = Joi.string()
  .trim()
  .min(1)
  .max(128)
  .messages({
    "string.base": "Invalid value.",
    "string.empty": "Invalid value.",
    "string.min": "Invalid value.",
    "string.max": "Invalid value.",
  });

const kioskPunchSchema = Joi.object({
  input: identityValue, // Gym ID (numeric) or 10-digit phone
  memberCode: identityValue, // Post-picker exact selection (M0001/F0001/T0001)
  selectionToken: identityValue, // Post-picker server-issued, kiosk-bound token
})
  .unknown(false)
  .or("input", "memberCode", "selectionToken")
  .xor("input", "memberCode", "selectionToken");

export default kioskPunchSchema;
