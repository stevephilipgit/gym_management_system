import "dotenv/config";
import logger from "../../core/logger.js";
import { callGemini } from "./aiClient.js";
import { get as getCachedResponse, set as setCachedResponse } from "./aiCache.js";
import {
  addMessage,
  clearMemory,
  getHistory,
  getMemory,
  setMemory,
} from "./conversationStore.js";
import { executeConfirmed, runAgent } from "./agentRunner.js";
import { cancelPending } from "./pendingActionStore.js";
import { buildSystemPrompt } from "./promptTemplates.js";
import { executeTool } from "./toolExecutor.js";
import { isValidTool, requiresConfirmation } from "./toolSchemas.js";

const injectionPatterns = [
  /ignore (previous|all|above) instructions/i,
  /ignore .*instructions/i,
  /you are now/i,
  /system prompt/i,
  /forget your/i,
  /act as/i,
];

const buildExpiringText = (result) =>
  `${result.count} member(s) have memberships expiring in the next ${result.daysWindow} days.`;

const buildConfirmationText = (result) =>
  `I found ${result.previewData?.count || 0} member(s) expiring soon. Here are the details. Please confirm to prepare reminders.`;

const buildAgentSummaryText = (result) => {
  if (result?.reminders) {
    return `${result.count} reminder(s) are ready with WhatsApp links.`;
  }

  if (result?.members) {
    return buildExpiringText(result);
  }

  if (typeof result?.count === "number") {
    return `There are ${result.count} total members in the gym.`;
  }

  return "The requested steps completed successfully.";
};

const buildRuleBasedResponse = async (cleanMessage) => {
  const normalizedMessage = cleanMessage.toLowerCase();

  if (
    normalizedMessage.includes("total") ||
    normalizedMessage.includes("how many") ||
    normalizedMessage.includes("count")
  ) {
    const result = await executeTool("getTotalMembers", {});
    return {
      text: `There are ${result.count} total members in the gym.`,
      data: result,
      source: "rule-based",
    };
  }

  if (
    normalizedMessage.includes("expiring") ||
    normalizedMessage.includes("expire") ||
    normalizedMessage.includes("renewal")
  ) {
    const extractedNum = normalizedMessage.match(/\d+/);
    const result = await executeTool("getExpiringMembers", {
      days: extractedNum ? Number(extractedNum[0]) : 7,
    });
    return {
      text: buildExpiringText(result),
      data: result,
      source: "rule-based",
    };
  }

  return {
    text: "I can help you with member counts and expiring memberships. Try asking about total members or expiring memberships.",
    source: "rule-based",
  };
};

const finalizeResponse = (sessionId, originalMessage, cacheKey, response) => {
  if (response?.data?.members) {
    setMemory(sessionId, "lastMembers", response.data.members);
  }
  if (!response.requiresConfirmation && response.source !== "confirmed" && response.source !== "cancelled") {
    setCachedResponse(cacheKey, response);
  }
  addMessage(sessionId, "user", originalMessage);
  addMessage(sessionId, "model", response.text);
  return response;
};

const buildToolResponse = (toolName, toolData) => {
  if (toolName === "getTotalMembers") {
    return {
      text: `There are ${toolData.count} total members in the gym.`,
      data: toolData,
      source: "ai",
    };
  }

  if (toolName === "getExpiringMembers") {
    return {
      text: buildExpiringText(toolData),
      data: toolData,
      source: "ai",
    };
  }

  return {
    text: "I can only access approved data sources.",
    source: "ai",
  };
};

export const processMessage = async (message, sessionId) => {
  if (!message || typeof message !== "string") {
    throw new Error("Message cannot be empty");
  }

  const strippedMessage = message.replace(/<[^>]*>/g, "").trim();

  if (!strippedMessage) {
    throw new Error("Message cannot be empty");
  }

  if (strippedMessage.length > 500) {
    throw new Error("Message too long. Max 500 characters.");
  }

  const cached = getCachedResponse(strippedMessage);
  if (cached) {
    return { ...cached, source: "cache" };
  }

  if (injectionPatterns.some((pattern) => pattern.test(strippedMessage))) {
    const blockedResponse = { text: "I can only help with gym-related queries.", source: "blocked" };
    return finalizeResponse(sessionId, strippedMessage, strippedMessage, blockedResponse);
  }

  const pendingToken = getMemory(sessionId, "pendingToken");
  if (pendingToken) {
    if (/^\s*(yes|confirm|send|proceed|ok|approve|do it)\s*$/i.test(strippedMessage)) {
      const confirmed = await executeConfirmed(pendingToken);
      clearMemory(sessionId, "pendingToken");
      clearMemory(sessionId, "lastPreviewData");
      if (!confirmed.success) {
        throw new Error(confirmed.message);
      }
      return finalizeResponse(sessionId, strippedMessage, strippedMessage, {
        text: "Done. Reminders prepared.",
        data: confirmed.data,
        source: "confirmed",
      });
    }

    if (/^\s*(no|cancel|stop|nevermind|nope)\s*$/i.test(strippedMessage)) {
      cancelPending(pendingToken);
      clearMemory(sessionId, "pendingToken");
      return finalizeResponse(sessionId, strippedMessage, strippedMessage, {
        text: "Action cancelled.",
        source: "cancelled",
      });
    }
    // If neither confirm nor cancel, fall through to AI with context
  }

  const aiEnabled = String(process.env.AI_ENABLED).toLowerCase() === "true";
  let aiResponse = null;

  if (aiEnabled) {
    const history = getHistory(sessionId);
    const systemPrompt = buildSystemPrompt();

    try {
      const aiText = await callGemini(systemPrompt, history, strippedMessage);

      const cleaned = aiText.trim().replace(/```json|```/g, "").trim();
      let parsed = null;

      try {
        parsed = JSON.parse(cleaned);
      } catch {
        aiResponse = { text: cleaned, source: "ai" };
      }

      if (!aiResponse && parsed) {
        if (parsed.steps && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
          const result = await runAgent(parsed.steps, sessionId);

          if (result.requiresConfirmation) {
            setMemory(sessionId, "pendingToken", result.confirmationToken);
            setMemory(sessionId, "lastPreviewData", result.previewData);
            aiResponse = {
              text: buildConfirmationText(result),
              requiresConfirmation: true,
              confirmationToken: result.confirmationToken,
              previewData: result.previewData,
              source: "agent",
            };
          } else if (result.partialData) {
            aiResponse = {
              text: `Partial completion. ${result.error}`,
              data: result.partialData,
              source: "agent",
            };
          } else {
            aiResponse = {
              text: buildAgentSummaryText(result),
              data: result,
              source: "agent",
            };
          }
        } else if (parsed.tool && typeof parsed.tool === "string") {
          if (!isValidTool(parsed.tool)) {
            logger.warn("[AI Security] Attempted unknown tool:", parsed.tool);
            aiResponse = {
              text: "I can only access approved data sources.",
              source: "ai",
            };
          } else if (requiresConfirmation(parsed.tool)) {
            aiResponse = {
              text: "I need to review the matching members first before preparing reminders.",
              source: "ai",
            };
          } else {
            const toolData = await executeTool(parsed.tool, parsed.params || {});
            aiResponse = buildToolResponse(parsed.tool, toolData);
          }
        } else {
          aiResponse = { text: cleaned, source: "ai" };
        }
      }
    } catch (error) {
      logger.error("[AI] Gemini error:", error);
    }
  }

  let finalResponse;
  if (aiResponse) {
    finalResponse = aiResponse;
  } else {
    const fallbackResponse = await buildRuleBasedResponse(strippedMessage);
    finalResponse = {
      ...fallbackResponse,
      source: aiEnabled ? "fallback" : fallbackResponse.source,
    };
  }

  return finalizeResponse(sessionId, strippedMessage, strippedMessage, finalResponse);
};
