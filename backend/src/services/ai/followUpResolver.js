/**
 * Follow-up intent resolution — interprets a new message using the active
 * conversational context (NOT in isolation).
 *
 * Classifies the message as:
 *   - new          → fresh query (no dependency on context)
 *   - modify       → add/change typed filters on the active member query
 *   - reference    → asks about the previous result set (count / names / first N)
 *   - presentation → transforms presentation of the current result
 *   - explanation  → "why" questions about the active query
 *   - clarify      → ambiguous reference; ask, don't guess
 *   - conversation → general chat
 *
 * This resolver NEVER executes tools and NEVER trusts the model for scope. It
 * only returns a structured intent the backend validates and executes through
 * the normal tool executor with fresh data.
 */

import { normalizeMessage, extractDays } from "./intentResolver.js";
import { describeContext } from "./conversationContext.js";

const GENDER_SIGNALS = [
  { tokens: ["male", "men", "boys"], value: "Male" },
  { tokens: ["female", "femle", "women", "girls", "ladies"], value: "Female" },
  { tokens: ["transgender", "trans", "third"], value: "Transgender" },
];

const PAYMENT_SIGNALS = [
  { tokens: ["unpaid", "not paid", "notpay", "pending", "due"], value: "not_paid" },
  { tokens: ["paid", "paying"], value: "paid" },
];

const STATUS_SIGNALS = [
  { tokens: ["active", "enrolled"], value: "active" },
];

// "them / those / these / their / that list / the same / among them" → reference.
const REFERENCE_PATTERNS = [
  /(^|\s)(them|those|these|their|they|that list|the same|among them|of them|which of them|from them)(\s|$|\.)/,
  /(^|\s)their\s+(names|phone|details)/,
  /how many\s+(of|are)?\s*(them|those|these)/,
  /which\s+(of\s+)?(them|those|these|the)/,
];

// "only / just / also / what about / and / plus" → filter modification.
const MODIFY_PATTERNS = [
  /(^|\s)(only|just|also|add|plus|and|what about|how about|now|further)(\s|$)/,
  /(^|\s)only\s+(unpaid|paid|male|female|males|females|active)/,
];

const isReference = (normalized) => REFERENCE_PATTERNS.some((re) => re.test(normalized));
const isModify = (normalized) => MODIFY_PATTERNS.some((re) => re.test(normalized));

const isCountRequest = (normalized) =>
  /(^|\s)(how many|count|number of|total)(\s|$)/.test(normalized) ||
  /how many\s+(of|are)?\s*(them|those|these)/.test(normalized);

const isNamesRequest = (normalized) =>
  /(show|list|give|display|tell).*(names|them|list|members)/.test(normalized) ||
  /their\s+names/.test(normalized) ||
  /show (me )?(them|those|these)/.test(normalized);

const isFirstN = (normalized) => {
  const match = normalized.match(/(first|top)\s+(\d+)/);
  return match ? Number(match[2]) : null;
};

const isExplanation = (normalized) => /(^|\s)(why|reason|how come|explain)(\s|$)/.test(normalized);

const extractGender = (normalized) => {
  for (const signal of GENDER_SIGNALS) {
    if (signal.tokens.some((token) => normalized.includes(token))) return signal.value;
  }
  return null;
};

const extractPayment = (normalized) => {
  for (const signal of PAYMENT_SIGNALS) {
    if (signal.tokens.some((token) => normalized.includes(token))) return signal.value;
  }
  return null;
};

const extractStatus = (normalized) => {
  for (const signal of STATUS_SIGNALS) {
    if (signal.tokens.some((token) => normalized.includes(token))) return signal.value;
  }
  return null;
};

/**
 * Resolve a follow-up message against the active conversational context.
 *
 * @param {string} message raw user message
 * @param {object} ctx active ConversationContext (may be empty)
 * @param {string|null} currentModule informational module
 * @returns {object} structured resolution (see module doc)
 */
export const resolveFollowUp = (message, ctx = {}, currentModule = null) => {
  const normalized = normalizeMessage(message);
  if (!normalized) {
    return { kind: "conversation", text: "I didn't catch that. Could you rephrase?" };
  }

  // "why" over the active query → explanation.
  if (isExplanation(normalized) && ctx?.activeIntent) {
    return { kind: "explanation", intent: ctx.activeIntent, filters: { ...(ctx.activeFilters || {}) } };
  }

  // Reference to previous result set.
  if (isReference(normalized)) {
    if (!ctx?.activeTool) {
      return {
        kind: "clarify",
        text: "I don't have a previous result to refer to. Could you ask a new question?",
      };
    }
    // Count of the referenced set.
    if (isCountRequest(normalized)) {
      return {
        kind: "reference",
        action: "count",
        tool: ctx.activeTool,
        filters: { ...(ctx.activeFilters || {}) },
        intent: ctx.activeIntent,
      };
    }
    // Names / list of the referenced set.
    if (isNamesRequest(normalized)) {
      return {
        kind: "reference",
        action: "names",
        tool: ctx.activeTool,
        filters: { ...(ctx.activeFilters || {}) },
        intent: ctx.activeIntent,
      };
    }
    return {
      kind: "clarify",
      text: `Which group do you mean — the ${describeContext(ctx) || "previous results"}?`,
    };
  }

  // Filter modification on the active member query.
  if (isModify(normalized) && ctx?.activeTool === "findMembers") {
    const gender = extractGender(normalized);
    const payment = extractPayment(normalized);
    const status = extractStatus(normalized);
    const days = extractDays(normalized);

    if (!gender && !payment && !status && !days) {
      return { kind: "conversation", text: "Could you add a filter like 'only unpaid' or 'only females'?" };
    }

    return {
      kind: "modify",
      tool: "findMembers",
      filters: {
        ...(ctx.activeFilters || {}),
        ...(gender ? { gender } : {}),
        ...(payment ? { paymentStatus: payment } : {}),
        ...(status ? { status } : {}),
        ...(days ? { expiresWithinDays: days } : {}),
      },
      intent: ctx.activeIntent || "members_overview",
    };
  }

  // Presentation transform of the current result.
  if (ctx?.activeTool && !isReference(normalized)) {
    const firstN = isFirstN(normalized);
    if (firstN) {
      return {
        kind: "reference",
        action: "first_n",
        n: Math.min(firstN, 20),
        tool: ctx.activeTool,
        filters: { ...(ctx.activeFilters || {}) },
        intent: ctx.activeIntent,
      };
    }
    if (isCountRequest(normalized)) {
      return {
        kind: "reference",
        action: "count",
        tool: ctx.activeTool,
        filters: { ...(ctx.activeFilters || {}) },
        intent: ctx.activeIntent,
      };
    }
    if (isNamesRequest(normalized)) {
      return {
        kind: "reference",
        action: "names",
        tool: ctx.activeTool,
        filters: { ...(ctx.activeFilters || {}) },
        intent: ctx.activeIntent,
      };
    }
  }

  return { kind: "new", tool: null, params: {} };
};

export default resolveFollowUp;