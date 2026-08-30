/**
 * Deterministic intent resolver — used for the deterministic fallback path and
 * as a secondary signal alongside the LLM.
 *
 * This is NOT the primary semantic engine (the LLM is). It exists so that when
 * the provider chain is unavailable, broken English / common typos still map to
 * a safe, validated tool call instead of failing. It also detects ambiguous
 * requests so the orchestrator can ask for clarification instead of guessing.
 *
 * Design constraints:
 *  - Bounded: operates on a single message, O(tokens × intents), no unbounded
 *    work, no external calls.
 *  - Typo-tolerant: token similarity via simple edit-distance on normalized
 *    tokens, not a giant regex dictionary.
 *  - Safe: it never invokes tools; it only returns an intent that the backend
 *    then validates and executes through the tool executor.
 */

import { getEnabledCapabilities } from "./capabilityCatalog.js";

const AMBIGUITY_THRESHOLD = 0.2; // top two scores within this → ask to clarify
const CONFIDENCE_FLOOR = 0.15; // below this → "I didn't understand"

// Intent definition: which capability a semantic phrase points to.
const INTENTS = [
  {
    id: "members_overview",
    tool: "getTotalMembers",
    signals: ["member", "members", "total", "count", "how many", "howmuch", "membars"],
    params: {},
  },
  {
    id: "active_members",
    tool: "getActiveMembersCount",
    signals: ["active", "active members"],
    params: {},
  },
  {
    id: "members_expiring",
    tool: "getExpiringMembers",
    signals: ["expire", "expiry", "expiring", "renewal", "renew", "expiration", "epxiry", "plan end"],
    params: {},
  },
  {
    id: "attendance",
    tool: "getTodayAttendanceCount",
    signals: ["attendance", "atandance", "check", "checked", "punch", "today attendance"],
    params: {},
  },
  {
    id: "inactive_members",
    tool: "getInactiveMembers",
    signals: ["inactive", "not visit", "not coming", "inactive memebrs", "long time", "idle"],
    params: {},
  },
  {
    id: "enquiries",
    tool: "getEnquiriesSummary",
    signals: ["enquiry", "enquiries", "enquire", "enquires", "customer enquiry"],
    params: {},
  },
  {
    id: "dashboard_insights",
    tool: "getDashboardSummary",
    signals: ["dashboard", "summary", "overview", "gym doing", "insight", "status", "snapshot"],
    params: {},
  },
];

/**
 * Minimal edit distance (Levenshtein) with an early exit — bounded by `max`.
 * O(n*m) but n/m are small normalized tokens.
 */
const editDistance = (a, b, max = 2) => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i === a.length && j === b.length && dp[i][j] > max) return dp[i][j];
    }
  }
  return dp[a.length][b.length];
};

/**
 * Normalize a message: lowercase, collapse whitespace, keep alphanumeric.
 */
export const normalizeMessage = (message) =>
  String(message || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Score an intent against a normalized message. Higher = more likely.
 * We look for signal words: exact substring OR edit-distance-tolerant token
 * match (handles "membars"→"members", "epxiry"→"expiry").
 */
const scoreIntent = (intent, normalized, tokens) => {
  let score = 0;
  for (const signal of intent.signals) {
    if (normalized.includes(signal)) {
      score += signal.length >= 7 ? 3 : 2;
      continue;
    }
    // Token-level fuzzy match for typo tolerance (only for short signals to
    // bound cost).
    if (signal.length >= 5 && signal.length <= 12) {
      for (const token of tokens) {
        if (editDistance(token, signal) <= 2) {
          score += 2;
          break;
        }
      }
    }
  }
  return score;
};

/**
 * Extract a numeric day-window from temporal phrases. Deterministic and
 * documented. Returns null when no explicit window is found.
 *
 *   "next week"/"this week" → 7
 *   "2 weeks" → 14
 *   "1 month" → 30
 *   "soon" → 7
 *   "tomorrow"/"today" → 1
 */
export const extractDays = (normalized) => {
  if (/2\s*weeks|two\s*weeks|14\s*days/.test(normalized)) return 14;
  if (/1\s*month|a\s*month|30\s*days/.test(normalized)) return 30;
  if (/1\s*week|a\s*week|7\s*days/.test(normalized)) return 7;
  if (/next\s*week|nxt\s*week|this\s*week|soon|7\s*days/.test(normalized)) return 7;
  if (/tomorrow|today/.test(normalized)) return 1;
  return null;
};

/**
 * Resolve a message to a concrete tool intent.
 *
 * @param {string} message raw user message
 * @param {string|null} currentModule informational module context
 * @returns {{
 *   resolved: boolean,
 *   tool?: string,
 *   params?: object,
 *   capabilityId?: string,
 *   confidence?: number,
 *   ambiguous?: boolean,
 *   alternatives?: string[],
 *   message?: string,
 * }}
 */
export const resolveIntent = (message, currentModule = null) => {
  const normalized = normalizeMessage(message);
  if (!normalized) {
    return { resolved: false, message: "I didn't catch that. Could you rephrase?" };
  }

  const tokens = normalized.split(" ");
  const scored = INTENTS.map((intent) => ({
    ...intent,
    score: scoreIntent(intent, normalized, tokens),
  }))
    .filter((intent) => intent.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { resolved: false, message: "I can help with members, expiry, attendance, inactivity, enquiries and dashboard insights." };
  }

  const top = scored[0];
  const second = scored[1];

  // Ambiguity: two intents nearly tie → ask, don't guess.
  if (second && top.score - second.score < AMBIGUITY_THRESHOLD * top.score) {
    return {
      resolved: false,
      ambiguous: true,
      alternatives: [top.id, second.id].filter(
        (id, i, arr) => arr.indexOf(id) === i
      ),
      message: "Could you clarify what you're looking for? I can help with members, expiring memberships, attendance, inactive members, enquiries, or dashboard insights.",
    };
  }

  const confidence = Math.min(1, top.score / 10);
  if (confidence < CONFIDENCE_FLOOR) {
    return { resolved: false, message: "I can help with members, expiry, attendance, inactivity, enquiries and dashboard insights." };
  }

  const days = extractDays(normalized);
  const params = { ...top.params };
  if (days && (top.tool === "getExpiringMembers" || top.tool === "getInactiveMembers")) {
    params.days = days;
  }

  const capability = getEnabledCapabilities().find((c) => c.id === top.id);
  if (capability && currentModule && !capability.supportedModules.includes(currentModule)) {
    // The capability exists but is off-module — still usable (backend is the
    // authority), but nudge nothing here; backend authorizes independently.
  }

  return {
    resolved: true,
    tool: top.tool,
    params,
    capabilityId: top.id,
    confidence: Number(confidence.toFixed(2)),
  };
};