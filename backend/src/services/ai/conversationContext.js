/**
 * Conversational context model.
 *
 * Bounded, derived, session-scoped orchestration state used to interpret
 * follow-up turns ("them", "only unpaid", "how many?"). It is NEVER:
 *   - an authorization mechanism (backend scope/tools remain authoritative)
 *   - a store of full tool results (only compact references/summaries)
 *   - long-term memory (AIUserMemory stays separate)
 *
 * All fields are small and bounded; the object is serialized into
 * ChatSession.metadata and must stay tiny.
 */

export const CONTEXT_VERSION = 1;
export const MAX_ACTIVE_FILTERS = 4;

export const EMPTY_CONTEXT = () => ({
  version: CONTEXT_VERSION,
  activeIntent: null,        // capability id
  activeTool: null,          // last tool that produced the active result set
  activeFilters: {},         // compact typed filters (max MAX_ACTIVE_FILTERS)
  lastResultType: null,      // e.g. "member_list"
  lastResultCount: null,     // total matched (not the rows)
  lastResultTruncated: null, // whether rows were capped
  currentModule: null,       // informational only
  lastTurnAt: null,          // ISO timestamp
});

/**
 * Read a bounded context from session metadata (never trust arbitrary keys).
 * @param {object} metadata ChatSession.metadata
 * @returns {object} a valid ConversationContext
 */
export const loadContext = (metadata = {}) => {
  const stored = metadata?.conversationContext || {};
  const ctx = EMPTY_CONTEXT();
  if (stored && typeof stored === "object") {
    if (stored.activeIntent && typeof stored.activeIntent === "string") {
      ctx.activeIntent = stored.activeIntent.slice(0, 80);
    }
    if (stored.activeTool && typeof stored.activeTool === "string") {
      ctx.activeTool = stored.activeTool.slice(0, 80);
    }
    if (stored.activeFilters && typeof stored.activeFilters === "object") {
      const keys = Object.keys(stored.activeFilters).slice(0, MAX_ACTIVE_FILTERS);
      for (const key of keys) {
        const value = stored.activeFilters[key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          ctx.activeFilters[key] = value;
        }
      }
    }
    if (typeof stored.lastResultType === "string") {
      ctx.lastResultType = stored.lastResultType.slice(0, 40);
    }
    if (typeof stored.lastResultCount === "number") {
      ctx.lastResultCount = stored.lastResultCount;
    }
    if (typeof stored.lastResultTruncated === "boolean") {
      ctx.lastResultTruncated = stored.lastResultTruncated;
    }
    if (typeof stored.currentModule === "string") {
      ctx.currentModule = stored.currentModule.slice(0, 40);
    }
    if (typeof stored.lastTurnAt === "string") {
      ctx.lastTurnAt = stored.lastTurnAt.slice(0, 40);
    }
  }
  return ctx;
};

/**
 * Compact the context for persistence (drops nothing sensitive, stays bounded).
 */
export const saveContext = (ctx) => ({
  version: CONTEXT_VERSION,
  activeIntent: ctx.activeIntent || null,
  activeTool: ctx.activeTool || null,
  activeFilters: Object.fromEntries(
    Object.entries(ctx.activeFilters || {}).slice(0, MAX_ACTIVE_FILTERS)
  ),
  lastResultType: ctx.lastResultType || null,
  lastResultCount: ctx.lastResultCount ?? null,
  lastResultTruncated: ctx.lastResultTruncated ?? null,
  currentModule: ctx.currentModule || null,
  lastTurnAt: ctx.lastTurnAt || null,
});

/**
 * Record a successful tool execution as the new active context.
 * Stores ONLY a compact reference + summary — never the row data.
 */
export const recordToolResult = (ctx, { tool, params = {}, result = {}, currentModule = null }) => {
  const next = { ...ctx };
  next.activeTool = tool;
  next.lastTurnAt = new Date().toISOString();
  next.currentModule = currentModule || ctx.currentModule || null;

  const count =
    typeof result.count === "number"
      ? result.count
      : Array.isArray(result.members)
        ? result.members.length
        : null;
  next.lastResultCount = count;
  next.lastResultTruncated = result.truncated === true;

  // Derive compact typed filters from the tool result semantics.
  if (tool === "getExpiringMembers") {
    next.activeFilters = { ...next.activeFilters, expiresWithinDays: result.daysWindow ?? 7 };
    next.lastResultType = "member_list";
    next.activeIntent = "members_expiring";
  } else if (tool === "getInactiveMembers") {
    next.activeFilters = { ...next.activeFilters, inactiveForDays: params.days ?? 30 };
    next.lastResultType = "member_list";
    next.activeIntent = "inactive_members";
  } else if (tool === "getTotalMembers" || tool === "getActiveMembersCount") {
    next.lastResultType = "member_count";
    next.activeIntent = "members_overview";
  } else if (tool === "getTodayAttendanceCount") {
    next.lastResultType = "attendance_count";
    next.activeIntent = "attendance";
  } else if (tool === "getEnquiriesSummary") {
    next.lastResultType = "enquiry_summary";
    next.activeIntent = "enquiries";
  } else if (tool === "getDashboardSummary") {
    next.lastResultType = "dashboard_summary";
    next.activeIntent = "dashboard_insights";
  } else if (tool === "findMembers") {
    next.activeFilters = { ...next.activeFilters, ...sanitizeMemberFilters(params) };
    next.lastResultType = "member_list";
    next.activeIntent = params.expiresWithinDays ? "members_expiring" : "members_overview";
  }

  return next;
};

/**
 * Keep only typed, bounded member filters (never arbitrary DB filters).
 */
const sanitizeMemberFilters = (params = {}) => {
  const filters = {};
  const allowed = ["gender", "paymentStatus", "expiresWithinDays", "inactiveForDays", "status"];
  for (const key of allowed) {
    if (params[key] !== undefined && params[key] !== null && params[key] !== "") {
      filters[key] = params[key];
    }
  }
  return Object.fromEntries(Object.entries(filters).slice(0, MAX_ACTIVE_FILTERS));
};

/**
 * Human-readable summary of the active context (used in prompts / responses).
 */
export const describeContext = (ctx) => {
  if (!ctx?.activeTool) return null;
  const filters = Object.entries(ctx.activeFilters || {})
    .filter(([key, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  const count = ctx.lastResultCount != null ? ` (${ctx.lastResultCount} matched)` : "";
  return `${ctx.activeTool}${filters ? ` filters[${filters}]` : ""}${count}`;
};

export { sanitizeMemberFilters };