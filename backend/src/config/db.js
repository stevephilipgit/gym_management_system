import mongoose from "mongoose";
import config from "./index.js";
import logger from "../core/logger.js";
import { srvDnsFailureHint } from "./dnsResolver.js";

// A transient DNS/network hiccup must not kill the process on the first
// attempt, so connect with exponential backoff before giving up.
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const SERVER_SELECTION_TIMEOUT_MS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connect to MongoDB with retry/backoff.
 *
 * Resolves only once the connection is established, because `server.js` awaits
 * this before initialising cron jobs and the HTTP listener. When every attempt
 * fails the process exits non-zero so a supervisor can restart it.
 */
const connectDB = async () => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await mongoose.connect(config.db.url, {
        serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      });
      logger.info("✅ MongoDB Connected Successfully!");
      return;
    } catch (err) {
      // Single string message: winston drops extra positional args with our
      // custom printf format, and this failure must land in logs/error.log.
      logger.error(`❌ MongoDB Connection Failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);

      // SRV/TXT lookups (only used by `mongodb+srv://` URIs) go through Node's
      // c-ares resolver; report the likely cause when that is what broke.
      const hint = /querySrv|queryTxt/i.test(err.message) ? srvDnsFailureHint() : null;
      if (hint) logger.error(hint);

      if (attempt >= MAX_RETRIES) {
        logger.error("❌ MongoDB connection exhausted retries. Exiting.");
        process.exit(1);
      }

      // Drop any half-open pool so the next attempt starts from a clean state.
      await mongoose.disconnect().catch(() => {});

      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(`Retrying MongoDB connection in ${delay}ms...`);
      await sleep(delay);
    }
  }
};

export default connectDB;
