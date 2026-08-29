import logger from "../core/logger.js";
import { processMessage } from "../services/ai/chatService.js";
import * as sessionService from "../services/ai/sessionService.js";
import * as memoryService from "../services/ai/memoryService.js";

export const handleChat = async (req, res) => {
  const { message, sessionId, currentModule } = req.body || {};
  const admin = req.admin;
  const ownerUserId = admin.id;

  const result = await processMessage({
    message,
    sessionId,
    currentModule,
    admin,
  });

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

  const history = await sessionService.getHistory(id, req.admin.id);
  return res.status(200).json({ success: true, data: { session, history } });
};

export const archiveSession = async (req, res) => {
  const { id } = req.params;
  const result = await sessionService.archiveSession(id, req.admin.id);
  if (!result) {
    return res.status(404).json({ success: false, message: "Session not found" });
  }
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