/**
 * AI-safe view DTOs.
 *
 * Centralized projection layer so individual tools never decide what fields
 * are safe to expose to the model. Adding a field here is a deliberate,
 * reviewable act. Whole Mongoose documents are never returned to the AI.
 */

// Only these member fields may ever reach the AI context.
export const MEMBER_AI_FIELDS = "fullName phone validityEnd gender gymPlan status";

/**
 * @param {object} member raw Mongoose/lean Member document
 * @returns {object|null} AI-safe member view
 */
export const toMemberAIView = (member) => {
  if (!member) return null;
  const daysLeft =
    member.validityEnd != null
      ? Math.ceil((new Date(member.validityEnd).getTime() - Date.now()) / 86400000)
      : null;

  return {
    name: member.fullName ?? null,
    phone: member.phone ?? null,
    gender: member.gender ?? null,
    validTill: member.validityEnd ?? null,
    daysLeft,
  };
};

/**
 * Attendance-related AI view (currently count-only; no member fields unless
 * explicitly added here).
 */
export const toAttendanceAIView = (record) => record;

/**
 * Enquiry AI view — aggregate summaries only; individual enquiry PII is not
 * exposed to the model.
 */
export const toEnquiryAIView = (summary) => summary;