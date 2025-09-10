import redisClient from "../config/redis.js";

export const cacheGet = async (key, ttlSeconds, fetchFn) => {
  try {
    const cached = await redisClient.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    // ignore cache read failure
  }

  const data = await fetchFn();

  try {
    if (data) {
      await redisClient.setEx(key, ttlSeconds, JSON.stringify(data));
    }
  } catch {
    // ignore cache write failure
  }

  return data;
};

export const cacheInvalidate = async (key) => {
  try {
    await redisClient.del(key);
  } catch (err) {
    console.warn("[Cache] Invalidation failed for key:", key, err.message);
  }
};

export const cacheInvalidatePattern = async (pattern) => {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (err) {
    console.warn("[Cache] Pattern invalidation failed:", pattern, err.message);
  }
};
