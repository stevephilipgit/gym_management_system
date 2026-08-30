import ChatSession from "../../models/ChatSession.js";
import ChatMessage from "../../models/ChatMessage.js";
import aiConfig from "../../config/aiConfig.js";
import { randomUUID } from "crypto";

const MAX_SCREEN_HISTORY_PAIRS = aiConfig.maxHistoryPairs;

/**
 * Create a new chat session for an admin.
 */
export const createSession = async (ownerUserId, metadata = {}) => {
  const sessionId = randomUUID();
  const session = await ChatSession.create({
    sessionId,
    ownerUserId,
    status: "active",
    metadata,
    lastActivityAt: new Date(),
  });
  return session;
};

/**
 * List active sessions for an admin, most recent first.
 * Ownership enforced: only the admin's own sessions are returned.
 */
export const listSessions = async (ownerUserId, limit = 20) => {
  return ChatSession.find({ ownerUserId, status: "active" })
    .sort({ lastActivityAt: -1 })
    .limit(limit)
    .select("sessionId status lastActivityAt createdAt metadata")
    .lean();
};

/**
 * Load a session — returns null if not found or not owned by this admin.
 */
export const loadSession = async (sessionId, ownerUserId) => {
  const session = await ChatSession.findOne({
    sessionId,
    ownerUserId,
  });
  if (!session) return null;
  return session;
};

/**
 * Archive a session (soft-delete). Ownership enforced.
 */
export const archiveSession = async (sessionId, ownerUserId) => {
  const result = await ChatSession.findOneAndUpdate(
    { sessionId, ownerUserId },
    { status: "archived" },
    { new: true }
  );
  return result;
};

/**
 * Update session lastActivityAt timestamp.
 */
export const touchSession = async (sessionId) => {
  await ChatSession.updateOne({ sessionId }, { lastActivityAt: new Date() });
};

/**
 * Add a message to a chat session. Ownership enforced via session lookup.
 */
export const addMessage = async (sessionId, ownerUserId, role, content, messageType = "text", data = null, providerMetadata = null) => {
  const message = await ChatMessage.create({
    sessionId,
    ownerUserId,
    role,
    content,
    messageType,
    data,
    providerMetadata,
  });
  await touchSession(sessionId);
  return message;
};

/**
 * Get conversation history (bounded most recent pairs) for a session.
 * Ownership enforced — only returns messages if admin owns the session.
 */
export const getHistory = async (sessionId, ownerUserId) => {
  const session = await ChatSession.findOne({ sessionId, ownerUserId });
  if (!session) return null;

  const messages = await ChatMessage.find({ sessionId, ownerUserId })
    .sort({ createdAt: 1 })
    .lean();

  const limit = MAX_SCREEN_HISTORY_PAIRS * 2;
  const recent = messages.slice(-limit);

  return recent.map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }],
  }));
};

/**
 * Get raw message documents for a session (frontend rendering).
 * Ownership enforced — returns null if the admin does not own the session.
 */
export const getSessionMessages = async (sessionId, ownerUserId) => {
  const session = await ChatSession.findOne({ sessionId, ownerUserId });
  if (!session) return null;

  return ChatMessage.find({ sessionId, ownerUserId })
    .sort({ createdAt: 1 })
    .limit(MAX_SCREEN_HISTORY_PAIRS * 2)
    .select("role content messageType data createdAt")
    .lean();
};