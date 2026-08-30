import logger from "../core/logger.js";
import { auditLog } from "../utils/auditLog.js";
import { ACTION_TYPES } from "../core/constants.js";
import { processMessage } from "../services/ai/chatService.js";
import * as sessionService from "../services/ai/sessionService.js";
import * as memoryService from "../services/ai/memoryService.js";
import { getCapabilitiesPayload } from "../services/ai/capabilityCatalog.js";

export const handleChat = async (req, res) => {
  const { message, sessionId, currentModule } = req.body || {};
  const admin = req.admin;
  const ownerUserId = admin.id;
  const started = Date.now();

  const result = await processMessage({
    message,
    sessionId,
    currentModule,
    admin,
  });

  // Audit: AI_CHAT event
  auditLog(req, {
    action: ACTION_TYPES.AI_CHAT,
    status: "SUCCESS",
    resourceType: "AIChat",
    resourceId: result.sessionId,
    details: {
      module: currentModule || null,
      source: result.source,
      toolCount: (result.tools || []).length,
      latencyMs: Date.now() - started,
    },
  });

  // Audit: per-tool query events
  for (const tool of result.tools || []) {
    auditLog(req, {
      action: ACTION_TYPES.AI_TOOL_QUERY,
      status: tool.status === "success" ? "SUCCESS" : "ERROR",
      resourceType: "AITool",
      resourceId: result.sessionId,
      details: {
        tool: tool.tool,
        latencyMs: tool.latencyMs || null,
      },
    });
  }

  logger.info("[AI] chat request", {
    adminId: ownerUserId,
    sessionId: result.sessionId,
    source: result.source,
    module: currentModule || null,
  });

  return res.status(200).json({
    success: true,
    sessionId: result.sessionId,
    response: {
      text: result.text,
      data: result.data || null,
      source: result.source,
    },
  });
};

export const getCapabilities = async (req, res) => {
  const module = String(req.query.module || "").replace(/[^a-z_]/g, "") || null;
  const capabilities = getCapabilitiesPayload(module);
  return res.status(200).json({ success: true, data: capabilities });
};

export const listSessions = async (req, res) => {
  const sessions = await sessionService.listSessions(req.admin.id);
  return res.status(200).json({ success: true, data: sessions });
};

export const loadSession = async (req, res) => {
  const { id } = req.params;
  const session = await sessionService.loadSession(id, req.admin.id);
  if (!session) {
    return res.status(404).json({ success: false, message: "Session not found" });
  }

  const messages = await sessionService.getSessionMessages(id, req.admin.id);
  return res.status(200).json({ success: true, data: { session, history: messages } });
};

export const archiveSession = async (req, res) => {
  const { id } = req.params;
  const result = await sessionService.archiveSession(id, req.admin.id);
  if (!result) {
    return res.status(404).json({ success: false, message: "Session not found" });
  }
  auditLog(req, {
    action: ACTION_TYPES.AI_SESSION_ARCHIVE,
    status: "SUCCESS",
    resourceType: "AISession",
    resourceId: id,
  });
  return res.status(200).json({ success: true, message: "Session archived" });
};

export const listMemory = async (req, res) => {
  const memory = await memoryService.listMemory(req.admin.id);
  return res.status(200).json({ success: true, data: memory });
};

export const deleteMemory = async (req, res) => {
  const { key } = req.params;
  await memoryService.deleteMemory(req.admin.id, key);
  return res.status(200).json({ success: true, message: "Memory deleted" });
};

export const clearMemory = async (req, res) => {
  await memoryService.clearAllMemory(req.admin.id);
  auditLog(req, {
    action: ACTION_TYPES.AI_MEMORY_CLEAR,
    status: "SUCCESS",
    resourceType: "AIMemory",
    resourceId: req.admin.id,
  });
  return res.status(200).json({ success: true, message: "All memory cleared" });
};