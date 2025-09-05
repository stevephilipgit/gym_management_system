import { randomUUID } from "crypto";

const PENDING_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 50;
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000;

const pendingActions = new Map();

export const createPending = (sessionId, toolName, params, context) => {
  if (pendingActions.size >= MAX_PENDING) {
    throw new Error("Too many pending actions");
  }

  const now = Date.now();
  const token = randomUUID();

  pendingActions.set(token, {
    token,
    sessionId,
    toolName,
    params,
    context,
    createdAt: new Date(now),
    expiresAt: new Date(now + PENDING_TTL_MS),
  });

  return token;
};

export const getPending = (token) => {
  const entry = pendingActions.get(token);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt.getTime() <= Date.now()) {
    pendingActions.delete(token);
    return null;
  }

  return entry;
};

export const confirmAndConsume = (token) => {
  const entry = getPending(token);
  if (!entry) {
    throw new Error("Action expired or not found. Please try again.");
  }

  pendingActions.delete(token);
  return entry;
};

export const cancelPending = (token) => {
  pendingActions.delete(token);
};

export const clearExpiredPending = () => {
  for (const [token, entry] of pendingActions.entries()) {
    if (entry.expiresAt.getTime() <= Date.now()) {
      pendingActions.delete(token);
    }
  }
};

const cleanupTimer = setInterval(clearExpiredPending, CLEANUP_INTERVAL_MS);
if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}
