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
};

export const isValidTool = (name) => Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name);
export const requiresConfirmation = (name) => Boolean(TOOL_REGISTRY[name]?.requiresConfirmation);
export const isSideEffectTool = (name) => Boolean(TOOL_REGISTRY[name]?.isSideEffect);