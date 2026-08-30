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
 * Add a message to a chat session. Ownership enforced via session lookup.
 *
 * Concurrency-safe: allocates the sequence atomically from the owning
 * ChatSession's messageSeq counter ($inc), so two simultaneous requests for
 * the same session can never receive the same sequence or interleave out of
 * order. If the session does not exist (or isn't owned), returns null.
 */
export const addMessage = async (sessionId, ownerUserId, role, content, messageType = "text", data = null, providerMetadata = null) => {
  // Atomically allocate the next sequence for THIS session+owner.
  const session = await ChatSession.findOneAndUpdate(
    { sessionId, ownerUserId },
    { $inc: { messageSeq: 1 }, lastActivityAt: new Date() },
    { new: true }
  );

  if (!session) return null;

  const message = await ChatMessage.create({
    sessionId,
    ownerUserId,
    role,
    content,
    messageType,
    data,
    providerMetadata,
    sequence: session.messageSeq,
  });
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
    .sort({ sequence: 1, createdAt: 1 })
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
    .sort({ sequence: 1, createdAt: 1 })
    .limit(MAX_SCREEN_HISTORY_PAIRS * 2)
    .select("role content messageType data createdAt")
    .lean();
};

/**
 * Archive active sessions that have been inactive for `archiveAfterDays`.
 *
 * Bounded + restart-safe: processes in batches of `batchSize`, only touching
 * owner-scoped documents older than the threshold. Running twice is harmless
 * (already-archived sessions are skipped by the active filter).
 *
 * @returns {Promise<number>} number of sessions archived
 */
export const archiveInactiveSessions = async ({ archiveAfterDays, batchSize = 50 } = {}) => {
  if (!archiveAfterDays || archiveAfterDays <= 0) return 0;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - archiveAfterDays);

  let archived = 0;
  // Repeated bounded batches until none remain (idempotent, crash-safe).
  for (;;) {
    const batch = await ChatSession.find({
      status: "active",
      lastActivityAt: { $lt: cutoff },
    })
      .select("_id")
      .limit(batchSize)
      .lean();

    if (batch.length === 0) break;

    const ids = batch.map((s) => s._id);
    const res = await ChatSession.updateMany(
      { _id: { $in: ids }, status: "active" },
      { $set: { status: "archived" } }
    );
    archived += res.modifiedCount || 0;
    if (batch.length < batchSize) break;
  }
  return archived;
};

/**
 * Permanently delete archived sessions (and their messages) older than
 * `retentionDays`. Memory (AIUserMemory) is NEVER touched.
 *
 * Bounded + restart-safe: batches of `batchSize`; a crash mid-way is resumed
 * on the next run because deletion is keyed on the same predicate.
 *
 * @returns {Promise<number>} number of sessions deleted
 */
export const deleteExpiredSessions = async ({ retentionDays, batchSize = 50 } = {}) => {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  let deleted = 0;
  for (;;) {
    const batch = await ChatSession.find({
      status: "archived",
      updatedAt: { $lt: cutoff },
    })
      .select("sessionId _id")
      .limit(batchSize)
      .lean();

    if (batch.length === 0) break;

    const sessionIds = batch.map((s) => s.sessionId);
    const ids = batch.map((s) => s._id);

    await ChatMessage.deleteMany({ sessionId: { $in: sessionIds } });
    const res = await ChatSession.deleteMany({ _id: { $in: ids } });
    deleted += res.deletedCount || 0;
    if (batch.length < batchSize) break;
  }
  return deleted;
};

/**
 * Run the full lifecycle: archive stale active sessions, then purge expired
 * archived sessions. Idempotent and bounded; safe to call from a cron.
 */
export const runSessionLifecycle = async ({ archiveAfterDays, retentionDays } = {}) => {
  const archived = await archiveInactiveSessions({ archiveAfterDays });
  const deleted = await deleteExpiredSessions({ retentionDays });
  return { archived, deleted };
};