import { TOOL_REGISTRY, isValidTool } from "./toolSchemas.js";

/**
 * Canonical capability catalog — the SINGLE source of truth for what the
 * assistant can do, described in HUMAN terms.
 *
 * - The backend tool registry (toolSchemas.js) remains the authoritative
 *   execution surface. This catalog only expresses supported functionality.
 * - The prompt layer and the frontend both derive from this catalog so there
 *   is never a duplicated, drift-prone list.
 * - Safe metadata (id, displayName, description, examplePrompts,
 *   supportedModules) is exposed to the frontend. Internal tool names and
 *   database details are never exposed.
 */

const CAPABILITY_CATALOG = [
  {
    id: "members_overview",
    displayName: "Members",
    description: "Total and active member counts for your gym.",
    supportedModules: ["dashboard", "all_members"],
    examplePrompts: [
      "How many total members are there?",
      "How many active members do I have?",
      "total membars",
    ],
    underlyingTools: ["getTotalMembers", "getActiveMembersCount"],
    enabled: true,
  },
  {
    id: "members_expiring",
    displayName: "Expiring memberships",
    description: "Find members whose memberships are expiring soon.",
    supportedModules: ["dashboard", "all_members"],
    examplePrompts: [
      "Show members whose memberships expire within 7 days.",
      "who expires next week",
      "givee epxiry memmebrs",
    ],
    underlyingTools: ["getExpiringMembers"],
    enabled: true,
  },
  {
    id: "attendance",
    displayName: "Attendance",
    description: "How many members checked in today.",
    supportedModules: ["dashboard", "attendance"],
    examplePrompts: [
      "How many members checked in today?",
      "today attendance",
      "today atandance",
    ],
    underlyingTools: ["getTodayAttendanceCount"],
    enabled: true,
  },
  {
    id: "inactive_members",
    displayName: "Inactive members",
    description: "Members who have not visited in a while.",
    supportedModules: ["dashboard", "inactivity_reports"],
    examplePrompts: [
      "Who has not visited for 30 days?",
      "show inactive memebrs",
      "who has not visited",
    ],
    underlyingTools: ["getInactiveMembers"],
    enabled: true,
  },
  {
    id: "enquiries",
    displayName: "Customer enquiries",
    description: "Summary of customer enquiries by status.",
    supportedModules: ["dashboard", "customer_enquiries"],
    examplePrompts: [
      "How many new enquiries are there?",
      "new enquires",
      "enquiry summary",
    ],
    underlyingTools: ["getEnquiriesSummary"],
    enabled: true,
  },
  {
    id: "dashboard_insights",
    displayName: "Dashboard insights",
    description: "A compact snapshot: totals, active, expiring, attendance and enquiries.",
    supportedModules: ["dashboard", "all_members", "attendance", "inactivity_reports", "customer_enquiries"],
    examplePrompts: [
      "Give me a dashboard summary",
      "how is the gym doing?",
      "overview",
    ],
    underlyingTools: ["getDashboardSummary"],
    enabled: true,
  },
];

// Validate the catalog against the tool registry at load time so a typo in a
// tool name fails fast instead of at runtime.
for (const capability of CAPABILITY_CATALOG) {
  for (const tool of capability.underlyingTools) {
    if (!isValidTool(tool)) {
      throw new Error(
        `Capability "${capability.id}" references unknown tool "${tool}"`
      );
    }
  }
}

export const getEnabledCapabilities = () => CAPABILITY_CATALOG.filter((c) => c.enabled);

/**
 * Capabilities relevant to a module (contextual). `null` module → all.
 */
export const getCapabilitiesForModule = (module) =>
  getEnabledCapabilities().filter(
    (c) => !module || c.supportedModules.includes(module)
  );

/**
 * Safe payload for the frontend — never includes internal tool names or any
 * backend details.
 */
export const getCapabilitiesPayload = (module) =>
  getCapabilitiesForModule(module).map(
    ({ id, displayName, description, examplePrompts, supportedModules }) => ({
      id,
      displayName,
      description,
      examplePrompts: examplePrompts.slice(0, 3),
      supportedModules,
    })
  );

/**
 * Example prompt for a capability — used by the frontend to route a clickable
 * capability through the NORMAL chat pipeline.
 */
export const getCapabilityExamplePrompt = (id) => {
  const capability = CAPABILITY_CATALOG.find((c) => c.id === id);
  return capability?.examplePrompts?.[0] || null;
};

export { CAPABILITY_CATALOG };