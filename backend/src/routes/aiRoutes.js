import { Router } from "express";
import { aiPerMinuteLimiter, aiPerHourLimiter } from "../middleware/aiRateLimiter.js";
import * as aiController from "../controllers/aiController.js";

const router = Router();

// Capability catalog — safe human-facing metadata (no internal tool names).
router.get("/capabilities", aiController.getCapabilities);

// Chat — send a message (creates/continues session)
router.post("/chat", aiPerHourLimiter, aiPerMinuteLimiter, aiController.handleChat);

// Sessions — list, load, archive
router.get("/sessions", aiController.listSessions);
router.get("/sessions/:id", aiController.loadSession);
router.post("/sessions/:id/archive", aiController.archiveSession);

// Memory — list, delete one, clear all (owner-scoped)
router.get("/memory", aiController.listMemory);
router.delete("/memory/:key", aiController.deleteMemory);
router.delete("/memory", aiController.clearMemory);

export default router;