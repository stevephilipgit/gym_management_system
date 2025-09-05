const MAX_HISTORY_PER_SESSION = 10;
const SESSION_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const sessions = new Map();

const ensureSession = (sessionId) => {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      messages: [],
      memory: {},
      lastActive: Date.now(),
    });
  }

  return sessions.get(sessionId);
};

export const getHistory = (sessionId) => {
  if (!sessionId || !sessions.has(sessionId)) {
    return [];
  }

  const session = ensureSession(sessionId);
  session.lastActive = Date.now();
  return session.messages;
};

export const addMessage = (sessionId, role, content) => {
  if (!sessionId || (role !== "user" && role !== "model")) {
    return;
  }

  const session = ensureSession(sessionId);
  session.messages.push({
    role,
    parts: [{ text: content }],
  });
  session.messages = session.messages.slice(-(MAX_HISTORY_PER_SESSION * 2));
  session.lastActive = Date.now();
};

export const clearExpired = () => {
  const cutoff = Date.now() - SESSION_TTL_MS;

  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastActive < cutoff) {
      sessions.delete(sessionId);
    }
  }
};

export const clearSession = (sessionId) => {
  sessions.delete(sessionId);
};

export const setMemory = (sessionId, key, value) => {
  if (!sessionId || !key) return;

  const session = ensureSession(sessionId);
  if (!session.memory || typeof session.memory !== "object") {
    session.memory = {};
  }
  session.memory[key] = value;
  session.lastActive = Date.now();
};

export const getMemory = (sessionId, key) => {
  if (!sessionId || !key || !sessions.has(sessionId)) {
    return null;
  }

  const session = ensureSession(sessionId);
  if (!session.memory || typeof session.memory !== "object") {
    session.memory = {};
  }
  session.lastActive = Date.now();
  return session.memory[key] ?? null;
};

export const clearMemory = (sessionId, key) => {
  if (!sessionId || !key || !sessions.has(sessionId)) {
    return;
  }

  const session = ensureSession(sessionId);
  if (!session.memory || typeof session.memory !== "object") {
    session.memory = {};
  }
  delete session.memory[key];
  session.lastActive = Date.now();
};

export const clearAllMemory = (sessionId) => {
  if (!sessionId || !sessions.has(sessionId)) {
    return;
  }

  const session = ensureSession(sessionId);
  session.memory = {};
  session.lastActive = Date.now();
};

const cleanupTimer = setInterval(clearExpired, CLEANUP_INTERVAL_MS);
if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

// SELF-TEST — remove after verification:
// const s = "test-session-fix";
// setMemory(s, "foo", [1,2,3]);
// console.assert(JSON.stringify(getMemory(s, "foo")) === "[1,2,3]", "setMemory/getMemory broken");
// clearMemory(s, "foo");
// console.assert(getMemory(s, "foo") === null, "clearMemory broken");
// console.log("[conversationStore] self-test passed");
