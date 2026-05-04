import { createClient } from "redis";
import config from "./index.js";

const redisClient = createClient({
  url: config.db.redisUrl,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) => {
      if (retries > 5) {
        console.error("[Redis] Too many reconnect attempts. Giving up.");
        return false;
      }
      return Math.min(retries * 200, 2000);
    },
  },
});

redisClient.on("connect", () => console.log("[Redis] Connected"));
redisClient.on("error", (err) => console.error("[Redis] Error:", err.message));
redisClient.on("reconnecting", () => console.log("[Redis] Reconnecting..."));

redisClient.connect().catch((err) => {
  console.error("[Redis] Initial connection failed:", err.message);
});

export default redisClient;
