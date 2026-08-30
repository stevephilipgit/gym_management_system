/**
 * AI tool registry — the ONLY data-access surface exposed to the model.
 * Every tool is whitelisted and validated; unknown tools are rejected.
 * Tools must not accept free-form MongoDB queries — params are typed
 * and validated by toolExecutor.
 */
export const TOOL_REGISTRY = {
  getTotalMembers: {
    name: "getTotalMembers",
    description: "Returns the total count of gym members the admin may access.",
    params: {},
    requiresConfirmation: false,
    isSideEffect: false,
  },
  getExpiringMembers: {
    name: "getExpiringMembers",
    description: "Returns members whose membership expires within N days.",
    params: {
      days: {
        type: "number",
        required: false,
        default: 7,
        min: 1,
        max: 90,
      },
    },
    requiresConfirmation: false,
    isSideEffect: false,
  },
  getActiveMembersCount: {
    name: "getActiveMembersCount",
    description: "Returns the count of currently active (paid) members.",
    params: {},
    requiresConfirmation: false,
    isSideEffect: false,
  },
  getTodayAttendanceCount: {
    name: "getTodayAttendanceCount",
    description: "Returns how many members checked in today.",
    params: {},
    requiresConfirmation: false,
    isSideEffect: false,
  },
  getEnquiriesSummary: {
    name: "getEnquiriesSummary",
    description: "Returns counts of customer enquiries by status (new/contacted/closed/spam).",
    params: {},
    requiresConfirmation: false,
    isSideEffect: false,
  },
  getInactiveMembers: {
    name: "getInactiveMembers",
    description: "Returns members who have been inactive (no attendance) for N days.",
    params: {
      days: {
        type: "number",
        required: false,
        default: 30,
        min: 1,
        max: 365,
      },
    },
    requiresConfirmation: false,
    isSideEffect: false,
  },
  getDashboardSummary: {
    name: "getDashboardSummary",
    description: "Returns a compact dashboard snapshot: totals, active, expiring, today attendance, enquiries.",
    params: {},
    requiresConfirmation: false,
    isSideEffect: false,
  },
  findMembers: {
    name: "findMembers",
    description: "Typed, bounded member query with composable filters (gender, payment status, expiry window, status). Returns a compact member list with count.",
    // All params are collected into a single filters object (no positional args).
    collectAs: "object",
    params: {
      gender: {
        type: "string",
        required: false,
        enum: ["Male", "Female", "Transgender"],
      },
      paymentStatus: {
        type: "string",
        required: false,
        enum: ["paid", "not_paid"],
      },
      expiresWithinDays: {
        type: "number",
        required: false,
        min: 1,
        max: 90,
      },
      inactiveForDays: {
        type: "number",
        required: false,
        min: 1,
        max: 365,
      },
      status: {
        type: "string",
        required: false,
        enum: ["active", "expired"],
      },
      limit: {
        type: "number",
        required: false,
        default: 20,
        min: 1,
        max: 20,
      },
    },
    requiresConfirmation: false,
    isSideEffect: false,
  },
};

export const isValidTool = (name) => Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name);
export const requiresConfirmation = (name) => Boolean(TOOL_REGISTRY[name]?.requiresConfirmation);
export const isSideEffectTool = (name) => Boolean(TOOL_REGISTRY[name]?.isSideEffect);