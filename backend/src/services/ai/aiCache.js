const CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

const cache = new Map();

const normalizeKey = (query) => String(query || "").trim().toLowerCase();

export const get = (query) => {
  const key = normalizeKey(query);
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.result;
};

export const set = (query, result) => {
  const key = normalizeKey(query);
  if (!key) return;

  if (!cache.has(key) && cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  cache.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

export const invalidate = (query) => {
  cache.delete(normalizeKey(query));
};

export const clear = () => {
  cache.clear();
};
