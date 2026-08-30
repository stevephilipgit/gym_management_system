import logger from "../../core/logger.js";
import aiConfig from "../../config/aiConfig.js";
import { generateWithFallback } from "./providerFactory.js";
import { buildSystemPrompt } from "./promptTemplates.js";
import { executeTool } from "./toolExecutor.js";
import { isValidTool } from "./toolSchemas.js";
import { fitHistoryToBudget, serializeMemoryBlock } from "./contextBudget.js";
import { resolveIntent } from "./intentResolver.js";
import { resolveFollowUp } from "./followUpResolver.js";
import {
  loadContext,
  saveContext,
  recordToolResult,
  describeContext,
} from "./conversationContext.js";
import * as sessionService from "./sessionService.js";
import * as memoryService from "./memoryService.js";

let contextTruncationCount = 0;

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

const buildMemberListText = (data) => {
  const suffix = data.truncated ? ` (showing the first ${data.members?.length || 0} of ${data.count})` : "";
  return `Found ${data.count} matching member(s).${suffix}`;
};

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
    case "findMembers":
      return buildMemberListText(data);
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

const buildRuleBasedResponse = async (cleanMessage, principal, currentModule = null) => {
  const intent = resolveIntent(cleanMessage, currentModule);

  if (!intent.resolved) {
    return {
      text: intent.message || "I can help with members, expiry, attendance, inactivity, enquiries and dashboard insights.",
      data: null,
      source: "deterministic",
    };
  }

  try {
    const data = await executeTool(intent.tool, intent.params || {}, principal);
    return { text: buildToolText(intent.tool, data), data, source: "deterministic" };
  } catch (error) {
    logger.warn("[AI] deterministic tool failed", { tool: intent.tool, error: error.message });
    return {
      text: "I couldn't retrieve that information right now. Please try again.",
      data: null,
      source: "deterministic",
    };
  }
};

/**
 * Map the active context to a fresh, validated findMembers call (or a plain
 * re-run of a count tool) so follow-ups always query current authoritative
 * data rather than trusting a stale snapshot.
 */
const buildContextualCall = (ctx) => {
  const memberListTools = new Set(["findMembers", "getExpiringMembers", "getInactiveMembers"]);
  if (memberListTools.has(ctx.activeTool)) {
    return { tool: "findMembers", params: { ...(ctx.activeFilters || {}) } };
  }
  if (ctx.activeTool && isValidTool(ctx.activeTool)) {
    return { tool: ctx.activeTool, params: {} };
  }
  return null;
};

const runToolAndRecord = async ({ tool, params, principal, ctx, module }) => {
  const started = Date.now();
  const data = await executeTool(tool, params || {}, principal);
  const updated = recordToolResult(ctx, {
    tool,
    params: params || {},
    result: data,
    currentModule: module,
  });
  return {
    data,
    updatedContext: updated,
    toolReport: { tool, status: "success", latencyMs: Date.now() - started },
  };
};

const explanationText = (ctx) => {
  const filters = Object.entries(ctx.activeFilters || {})
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return `This list was built from the active query${filters ? ` with the filter(s): ${filters}` : ""}. The results come from the current gym records, so they reflect the latest data.`;
};

/**
 * Process a user message within a chat session, resolving follow-ups against
 * the active conversational context.
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

  const ctx = loadContext(session.metadata || {});
  ctx.currentModule = module || ctx.currentModule || null;

  // Prompt-injection defense (best effort — backend authorization is the real
  // boundary; tool execution stays whitelisted).
  if (injectionPatterns.some((pattern) => pattern.test(cleanMessage))) {
    const blocked = {
      text: "I can only help with gym-related queries within my approved capabilities.",
      data: null,
      source: "blocked",
    };
    await sessionService.addMessage(sessionId, ownerUserId, "user", cleanMessage, "text");
    await sessionService.addMessage(sessionId, ownerUserId, "assistant", blocked.text, "text");
    return { sessionId, ...blocked, tools: [] };
  }

  const principal = {
    type: "user",
    scope: admin.scope === "all" ? "all" : admin.scope,
    adminId: ownerUserId,
  };

  // ── FOLLOW-UP RESOLUTION (context-aware, deterministic, fresh data) ──
  const followUp = resolveFollowUp(cleanMessage, ctx, module);

  if (followUp.kind !== "new") {
    const tools = [];
    let userResponse;
    let nextContext = ctx;

    if (followUp.kind === "clarify" || followUp.kind === "conversation") {
      userResponse = { text: followUp.text, data: null, source: "deterministic" };
    } else if (followUp.kind === "explanation") {
      userResponse = { text: explanationText(ctx), data: null, source: "deterministic" };
    } else if (followUp.kind === "modify") {
      const params = { ...followUp.filters };
      try {
        const { data, updatedContext, toolReport } = await runToolAndRecord({
          tool: "findMembers",
          params,
          principal,
          ctx,
          module,
        });
        nextContext = updatedContext;
        tools.push(toolReport);
        userResponse = { text: buildMemberListText(data), data, source: "deterministic" };
      } catch (error) {
        logger.warn("[AI] follow-up modify failed", { error: error.message });
        userResponse = {
          text: "I couldn't apply that filter right now. Please try again.",
          data: null,
          source: "deterministic",
        };
      }
    } else if (followUp.kind === "reference") {
      // Fresh re-query of the current logical result set.
      const call = buildContextualCall(ctx);
      if (!call) {
        userResponse = {
          text: "I don't have a previous result set to refer to. Could you ask a new question?",
          data: null,
          source: "deterministic",
        };
      } else {
        try {
          let params = { ...call.params };
          if (followUp.action === "first_n" && call.tool === "findMembers") {
            params.limit = Math.max(1, Math.min(followUp.n || 5, 20));
          }
          const { data, updatedContext, toolReport } = await runToolAndRecord({
            tool: call.tool,
            params,
            principal,
            ctx,
            module,
          });
          nextContext = updatedContext;
          tools.push(toolReport);
          if (followUp.action === "count") {
            const count =
              typeof data.count === "number"
                ? data.count
                : Array.isArray(data.members)
                  ? data.members.length
                  : null;
            userResponse = {
              text: count != null ? `That's ${count} member(s) in the current result set.` : buildToolText(call.tool, data),
              data: count != null ? { count } : data,
              source: "deterministic",
            };
          } else {
            userResponse = { text: buildToolText(call.tool, data), data, source: "deterministic" };
          }
        } catch (error) {
          logger.warn("[AI] follow-up reference failed", { error: error.message });
          userResponse = {
            text: "I couldn't re-query that result right now. Please try again.",
            data: null,
            source: "deterministic",
          };
        }
      }
    }

    // Persist the updated conversational context + messages.
    session.metadata = { ...(session.metadata || {}), conversationContext: saveContext(nextContext) };
    await session.save().catch(() => {});
    await sessionService.addMessage(sessionId, ownerUserId, "user", cleanMessage, "text");
    await sessionService.addMessage(
      sessionId,
      ownerUserId,
      "assistant",
      userResponse.text,
      userResponse.data ? "data" : "text",
      userResponse.data || null
    );
    return { sessionId, ...userResponse, tools };
  }

  // ── NEW QUERY PATH ───────────────────────────────────────────
  if (!aiConfig.enabled) {
    const fallback = await buildRuleBasedResponse(cleanMessage, principal, module);
    session.metadata = { ...(session.metadata || {}), conversationContext: saveContext(ctx) };
    await session.save().catch(() => {});
    await sessionService.addMessage(sessionId, ownerUserId, "user", cleanMessage, "text");
    await sessionService.addMessage(
      sessionId,
      ownerUserId,
      "assistant",
      fallback.text,
      fallback.data ? "data" : "text",
      fallback.data || null
    );
    return { sessionId, ...fallback, tools: [] };
  }

  const history = await sessionService.getHistory(sessionId, ownerUserId);
  const memory = await memoryService.listMemory(ownerUserId);

  const contextHint = describeContext(ctx);
  const systemPrompt = buildSystemPrompt(module, memory, contextHint);
  const memoryBlock = serializeMemoryBlock(memory);

  const budgeted = fitHistoryToBudget({
    systemPrompt,
    memoryBlock,
    currentMessage: cleanMessage,
    history: history || [],
    budgetChars: aiConfig.maxContextLength,
  });

  if (budgeted.truncated) {
    contextTruncationCount += 1;
    logger.warn("[AI] context budget truncation", {
      droppedMessages: budgeted.droppedCount,
      usedChars: budgeted.usedChars,
      budgetChars: budgeted.budgetChars,
      truncationCount: contextTruncationCount,
    });
  }

  let aiResult;
  try {
    aiResult = await generateWithFallback({
      systemPrompt,
      history: budgeted.history,
      userMessage: cleanMessage,
    });
  } catch (error) {
    logger.warn("[AI] provider chain failed", { error: error.message });
    const fallback = await buildRuleBasedResponse(cleanMessage, principal, module);
    const userFacing = {
      text: fallback.text,
      data: fallback.data || null,
      source: "deterministic",
    };
    session.metadata = { ...(session.metadata || {}), conversationContext: saveContext(ctx) };
    await session.save().catch(() => {});
    await sessionService.addMessage(sessionId, ownerUserId, "user", cleanMessage, "text");
    await sessionService.addMessage(
      sessionId,
      ownerUserId,
      "assistant",
      userFacing.text,
      userFacing.data ? "data" : "text",
      userFacing.data || null
    );
    return { sessionId, ...userFacing, tools: [] };
  }

  const aiText = aiResult.text;
  const aiSource = aiResult.source === "fallback_ai" ? "fallback_ai" : "ai";
  const { parsed, isJson, text: plainText } = parseModelResponse(aiText);

  let userResponse;
  const tools = [];
  let nextContext = ctx;

  if (isJson && parsed.steps && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
    const results = [];
    const data = {};
    for (const step of parsed.steps.slice(0, 5)) {
      if (!step?.tool || !isValidTool(step.tool)) continue;
      try {
        const stepData = await executeTool(step.tool, step.params || {}, principal);
        data[step.tool] = stepData;
        results.push({ tool: step.tool, params: step.params || {} });
        nextContext = recordToolResult(nextContext, {
          tool: step.tool,
          params: step.params || {},
          result: stepData,
          currentModule: module,
        });
        tools.push({ tool: step.tool, status: "success" });
      } catch (error) {
        logger.warn("[AI] tool step failed", { tool: step.tool, error: error.message });
        tools.push({ tool: step.tool, status: "error" });
      }
    }
    const text = summarizeResults(results, data);
    userResponse = {
      text,
      data: results.length ? { results, ...data } : null,
      source: aiSource,
    };
  } else if (isJson && parsed.tool && isValidTool(parsed.tool)) {
    try {
      const started = Date.now();
      const toolData = await executeTool(parsed.tool, parsed.params || {}, principal);
      nextContext = recordToolResult(nextContext, {
        tool: parsed.tool,
        params: parsed.params || {},
        result: toolData,
        currentModule: module,
      });
      tools.push({ tool: parsed.tool, status: "success", latencyMs: Date.now() - started });
      userResponse = {
        text: buildToolText(parsed.tool, toolData),
        data: toolData,
        source: aiSource,
      };
    } catch (error) {
      logger.warn("[AI] tool failed", { tool: parsed.tool, error: error.message });
      tools.push({ tool: parsed.tool, status: "error" });
      userResponse = {
        text: "I couldn't retrieve that information right now. Please try again.",
        data: null,
        source: aiSource,
      };
    }
  } else {
    userResponse = { text: plainText || aiText.trim(), data: null, source: aiSource };
  }

  session.metadata = { ...(session.metadata || {}), conversationContext: saveContext(nextContext) };
  await session.save().catch(() => {});
  await sessionService.addMessage(sessionId, ownerUserId, "user", cleanMessage, "text");
  await sessionService.addMessage(
    sessionId,
    ownerUserId,
    "assistant",
    userResponse.text,
    userResponse.data ? "data" : "text",
    userResponse.data || null
  );

  return { sessionId, ...userResponse, tools };
};