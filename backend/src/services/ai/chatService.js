import logger from "../../core/logger.js";
import aiConfig from "../../config/aiConfig.js";
import { generateWithFallback } from "./providerFactory.js";
import { buildSystemPrompt } from "./promptTemplates.js";
import { executeTool } from "./toolExecutor.js";
import { isValidTool } from "./toolSchemas.js";
import * as sessionService from "./sessionService.js";
import * as memoryService from "./memoryService.js";

const injectionPatterns = [
  /ignore (previous|all|above) instructions/i,
  /ignore .*instructions/i,
  /you are now/i,
  /system prompt/i,
  /forget your/i,
  /act as/i,
  /disregard (previous|all)/i,
  /reveal (api|secret|key|password)/i,
  /print (api|secret|key|password)/i,
];

const ALLOWED_MODULES = [
  "dashboard",
  "all_members",
  "attendance",
  "inactivity_reports",
  "customer_enquiries",
];

const sanitizeModule = (value) => {
  if (!value) return null;
  const normalized = String(value).toLowerCase().replace(/[^a-z_]/g, "");
  return ALLOWED_MODULES.includes(normalized) ? normalized : null;
};

const buildExpiringText = (result) =>
  `${result.count} member(s) have memberships expiring in the next ${result.daysWindow} days.`;

const buildToolText = (toolName, data) => {
  switch (toolName) {
    case "getTotalMembers":
      return `There are ${data.count} total members.`;
    case "getActiveMembersCount":
      return `There are ${data.count} active members.`;
    case "getExpiringMembers":
      return buildExpiringText(data);
    case "getTodayAttendanceCount":
      return `${data.count} member(s) checked in today.`;
    case "getEnquiriesSummary":
      return `Enquiries — new: ${data.new}, contacted: ${data.contacted}, closed: ${data.closed}, spam: ${data.spam} (total ${data.total}).`;
    case "getInactiveMembers":
      return `Found ${data.count} inactive member(s).`;
    case "getDashboardSummary":
      return `Dashboard — total: ${data.totalMembers}, active: ${data.activeMembers}, expiring in 7 days: ${data.expiringIn7Days}, today attendance: ${data.todayAttendance}, enquiries: ${data.enquiries.total}.`;
    default:
      return "Here is the requested information.";
  }
};

const summarizeResults = (results, data) => {
  const primary = results[0];
  if (!primary) return "Here is the requested information.";

  if (results.length === 1) {
    return buildToolText(primary.tool, data[primary.tool]);
  }

  return results
    .map(({ tool, params }) => {
      const d = data[tool];
      return d ? buildToolText(tool, d) : null;
    })
    .filter(Boolean)
    .join("\n");
};

const cleanJson = (text) =>
  text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/g, "")
    .trim();

const parseModelResponse = (text) => {
  const cleaned = cleanJson(text);
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && (parsed.tool || parsed.steps)) return { parsed, isJson: true };
    return { text: cleaned, isJson: false };
  } catch {
    return { text: cleaned, isJson: false };
  }
};

const buildRuleBasedResponse = async (cleanMessage, adminContext) => {
  const normalized = cleanMessage.toLowerCase();

  if (/(total|how many|count)/.test(normalized)) {
    const data = await executeTool("getTotalMembers", {}, adminContext);
    return { text: buildToolText("getTotalMembers", data), data, source: "rule-based" };
  }

  if (/(expiring|expire|renewal)/.test(normalized)) {
    const days = Number((normalized.match(/\d+/) || [7])[0]) || 7;
    const data = await executeTool("getExpiringMembers", { days }, adminContext);
    return { text: buildToolText("getExpiringMembers", data), data, source: "rule-based" };
  }

  if (/(attendance|checked in|check.?in)/.test(normalized)) {
    const data = await executeTool("getTodayAttendanceCount", {}, adminContext);
    return { text: buildToolText("getTodayAttendanceCount", data), data, source: "rule-based" };
  }

  if (/(enquir)/.test(normalized)) {
    const data = await executeTool("getEnquiriesSummary", {}, adminContext);
    return { text: buildToolText("getEnquiriesSummary", data), data, source: "rule-based" };
  }

  return {
    text: "I can help you with member counts, expiring memberships, attendance, inactivity, and enquiries. Try asking a question about your gym data.",
    source: "rule-based",
  };
};

/**
 * Process a user message within a chat session.
 *
 * @param {object} options
 * @param {string} options.message          raw user message
 * @param {string} [options.sessionId]      existing session id (optional — new session created if absent)
 * @param {string} [options.currentModule]  informational UI context (never trusted for authz)
 * @param {{ id:string, username:string, role:string, scope:string }} options.admin  authenticated admin
 */
export const processMessage = async ({ message, sessionId, currentModule, admin }) => {
  if (!message || typeof message !== "string") {
    const error = new Error("Message cannot be empty");
    error.status = 400;
    throw error;
  }

  const cleanMessage = message.replace(/<[^>]*>/g, "").trim();
  if (!cleanMessage) {
    const error = new Error("Message cannot be empty");
    error.status = 400;
    throw error;
  }
  if (cleanMessage.length > aiConfig.maxMessageLength) {
    const error = new Error(`Message too long. Max ${aiConfig.maxMessageLength} characters.`);
    error.status = 400;
    throw error;
  }

  const module = sanitizeModule(currentModule);
  const ownerUserId = admin.id;

  // Resolve the chat session (owned by this admin).
  let session;
  if (sessionId) {
    session = await sessionService.loadSession(sessionId, ownerUserId);
    if (!session) {
      const error = new Error("Chat session not found");
      error.status = 404;
      throw error;
    }
  } else {
    session = await sessionService.createSession(ownerUserId, { source: "floating-assistant" });
    sessionId = session.sessionId;
  }

  // Update informational module context (never used for authorization).
  if (module) {
    session.metadata = { ...(session.metadata || {}), currentModule: module };
    await session.save().catch(() => {});
  }

  // Prompt-injection defense (best effort — backend authorization is the
  // real boundary; tool execution stays whitelisted).
  if (injectionPatterns.some((pattern) => pattern.test(cleanMessage))) {
    const blocked = {
      text: "I can only help with gym-related queries within my approved capabilities.",
      data: null,
      source: "blocked",
    };
    await sessionService.addMessage(ownerUserId, sessionId, "user", cleanMessage, "text");
    await sessionService.addMessage(ownerUserId, sessionId, "assistant", blocked.text, "text");
    return { sessionId, ...blocked };
  }

  // Build admin context for scope-aware tool execution.
  const adminContext = { scope: admin.scope === "all" ? "all" : admin.scope };

  // Rule-based fallback when AI is disabled.
  if (!aiConfig.enabled) {
    const fallback = await buildRuleBasedResponse(cleanMessage, adminContext);
    await sessionService.addMessage(ownerUserId, sessionId, "user", cleanMessage, "text");
    await sessionService.addMessage(
      ownerUserId,
      sessionId,
      "assistant",
      fallback.text,
      fallback.data ? "data" : "text",
      fallback.data || null
    );
    return { sessionId, ...fallback };
  }

  // Load bounded conversation history + memory for context.
  const history = await sessionService.getHistory(sessionId, ownerUserId);
  const memory = await memoryService.listMemory(ownerUserId);

  const systemPrompt = buildSystemPrompt(module, memory);

  let aiText;
  try {
    aiText = await generateWithFallback({ systemPrompt, history, userMessage: cleanMessage });
  } catch (error) {
    logger.warn("[AI] provider chain failed", { error: error.message });
    const fallback = await buildRuleBasedResponse(cleanMessage, adminContext);
    const userFacing = {
      text: fallback.text,
      data: fallback.data || null,
      source: "fallback",
    };
    await sessionService.addMessage(ownerUserId, sessionId, "user", cleanMessage, "text");
    await sessionService.addMessage(
      ownerUserId,
      sessionId,
      "assistant",
      userFacing.text,
      userFacing.data ? "data" : "text",
      userFacing.data || null
    );
    return { sessionId, ...userFacing };
  }

  const { parsed, isJson, text: plainText } = parseModelResponse(aiText);

  let userResponse;

  if (isJson && parsed.steps && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
    const results = [];
    const data = {};
    for (const step of parsed.steps.slice(0, 5)) {
      if (!step?.tool || !isValidTool(step.tool)) continue;
      try {
        const stepData = await executeTool(step.tool, step.params || {}, adminContext);
        data[step.tool] = stepData;
        results.push({ tool: step.tool, params: step.params || {} });
      } catch (error) {
        logger.warn("[AI] tool step failed", { tool: step.tool, error: error.message });
      }
    }
    const text = summarizeResults(results, data);
    userResponse = {
      text,
      data: results.length ? { results, ...data } : null,
      source: "ai",
    };
  } else if (isJson && parsed.tool && isValidTool(parsed.tool)) {
    const toolData = await executeTool(parsed.tool, parsed.params || {}, adminContext);
    userResponse = {
      text: buildToolText(parsed.tool, toolData),
      data: toolData,
      source: "ai",
    };
  } else {
    userResponse = { text: plainText || aiText.trim(), data: null, source: "ai" };
  }

  await sessionService.addMessage(ownerUserId, sessionId, "user", cleanMessage, "text");
  await sessionService.addMessage(
    ownerUserId,
    sessionId,
    "assistant",
    userResponse.text,
    userResponse.data ? "data" : "text",
    userResponse.data || null
  );

  return { sessionId, ...userResponse };
};