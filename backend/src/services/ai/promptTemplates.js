import { TOOL_REGISTRY } from "./toolSchemas.js";
import { getEnabledCapabilities } from "./capabilityCatalog.js";

export const buildSystemPrompt = (currentModule = null, memory = [], contextHint = null) => {
  const toolList = Object.entries(TOOL_REGISTRY)
    .filter(([_, tool]) => !tool.isSideEffect)
    .map(([name, tool]) => {
      const params = Object.entries(tool.params || {})
        .map(([pName, cfg]) => {
          const def = Object.prototype.hasOwnProperty.call(cfg, "default") ? ` (default: ${cfg.default})` : "";
          return `${pName}:${cfg.type}${cfg.required ? ", required" : ", optional"}${def}`;
        })
        .join(", ") || "none";
      return `  - ${name}: ${tool.description} [params: ${params}]`;
    })
    .join("\n");

  // Human-facing capability list (same source of truth as the frontend).
  const capabilityList = getEnabledCapabilities()
    .map((c) => `  - ${c.displayName}: ${c.description}`)
    .join("\n");

  const moduleContext = currentModule
    ? `\nThe admin is currently viewing: ${currentModule}. Prefer tools relevant to this module when the question is ambiguous.`
    : "";

  const conversationContext = contextHint
    ? `\nCurrent conversation context (informational): ${contextHint}. Use it to interpret follow-up references like "them", "those", "only unpaid", "how many?" — but always re-query for fresh data via tools.`
    : "";

  const memoryContext =
    Array.isArray(memory) && memory.length > 0
      ? `\nKnown admin preferences/facts (use only as helpful context):\n${memory
          .map((entry) => `  - ${entry.key}: ${typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value)}`)
          .join("\n")}`
      : "";

  return `You are Giri Gym Assistant, an AI assistant for gym management.
You help super admins manage their gym by answering questions and providing
insights about members, attendance, inactivity, enquiries, and the dashboard.

YOUR CAPABILITIES (in human terms):
${capabilityList}

Your response MUST be in exactly one of the following formats — nothing else:

FORMAT A — Structured tool call (when the user asks for data):
Do ONE of:
  1. If you need exactly one tool: {"tool":"toolName","params":{}}
  2. If you need multiple independent tools (e.g. both total and expiring):
     {"steps":[{"tool":"toolName1","params":{}},{"tool":"toolName2","params":{}}]}

FORMAT B — Natural language (when the user is chatting, thanking, greeting,
  asking about your capabilities, or no tool fits):
  Just reply in plain text. Do NOT include JSON.

RULES:
  - Never explain or add text around JSON. Return ONLY the JSON.
  - Never wrap JSON in code blocks or markdown.
  - Understand natural language and common typos (e.g. "epxiry memmebrs"
    means "expiring members") — map the user's intent to the correct tool.
  - When days without number reference: "soon"=7, "this week"=7, "this month"=30.
  - Extract days from phrases like "2 weeks"=14, "1 month"=30.
  - If the request is ambiguous (it could reasonably mean two different
    capabilities), reply in plain text with a short clarifying question.
    Do NOT guess and do NOT execute an uncertain tool call.
  - Never ask the user for permissions — you are always authorized.
  - Never make up data — always call a tool.
  - If you don't understand, say so in plain text.
  - You may use memory facts to personalize, but never reveal them verbatim.

AVAILABLE TOOLS:
${toolList}
${moduleContext}
${conversationContext}
${memoryContext}`;
};