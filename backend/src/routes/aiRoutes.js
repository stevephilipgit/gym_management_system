import express from "express";
import { randomUUID } from "crypto";
import { aiRequestLimiter, aiStrictLimiter } from "../middleware/aiRateLimiter.js";
import { processMessage } from "../services/ai/chatService.js";
import { executeConfirmed } from "../services/ai/agentRunner.js";
import { cancelPending } from "../services/ai/pendingActionStore.js";

const router = express.Router();

router.post("/chat", aiStrictLimiter, aiRequestLimiter, async (req, res) => {
  try {
    const { message } = req.body || {};

    if (typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "message field is required",
      });
    }

    const sessionIdHeader = req.headers["x-session-id"];
    const sessionId =
      typeof sessionIdHeader === "string" && sessionIdHeader.trim()
        ? sessionIdHeader.trim()
        : randomUUID();

    const response = await processMessage(message, sessionId);

    return res.status(200).json({
      success: true,
      response: {
        text: response.text,
        data: response.data || null,
        source: response.source,
        sessionId,
        requiresConfirmation: Boolean(response.requiresConfirmation),
        confirmationToken: response.confirmationToken || null,
        previewData: response.previewData || null,
      },
    });
  } catch (error) {
    console.error("[AI Route] Error:", error);

    if (error.message === "Message cannot be empty" || error.message.startsWith("Message too long")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    if (error.message.startsWith("[ToolExecutor]")) {
      return res.status(502).json({
        success: false,
        message: "Unable to retrieve gym data right now.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "AI assistant is temporarily unavailable.",
    });
  }
});

router.post("/confirm", aiStrictLimiter, aiRequestLimiter, async (req, res) => {
  try {
    const { token, action } = req.body || {};

    if (typeof token !== "string" || !token.trim() || !["confirm", "cancel"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "token and valid action are required",
      });
    }

    if (action === "cancel") {
      cancelPending(token.trim());
      return res.status(200).json({
        success: true,
        response: { text: "Action cancelled." },
      });
    }

    const result = await executeConfirmed(token.trim());
    if (!result.success) {
      return res.status(410).json({
        success: false,
        message: "Action expired. Please start over.",
      });
    }

    return res.status(200).json({
      success: true,
      response: {
        text: "Reminders prepared.",
        data: result.data,
      },
    });
  } catch (error) {
    console.error("[AI Confirm Route] Error:", error);

    if (error.message === "Action expired or not found. Please try again.") {
      return res.status(410).json({
        success: false,
        message: "Action expired. Please start over.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to complete the requested action.",
    });
  }
});

export default router;
