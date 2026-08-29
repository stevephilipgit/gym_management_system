//  memberRoutes.js  

import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import memberController from "../controllers/memberController.js";
import draftController from "../controllers/draftController.js";
import adminAuth from "../middleware/adminAuth.js";
import requireRole from "../middleware/requireRole.js";
import { validateSchema } from "../middleware/schemaValidator.js";
import { memberRegisterSchema, memberUpdateSchema, memberRenewSchema } from "../schemas/memberSchema.js";
import { adminLimiter, sensitiveLimiter } from "../middleware/rateLimiter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

/* ============================================================
   RATE LIMIT (public validity check) - FOR PUBLIC ROUTE ONLY
============================================================ */
const validityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: "Too many requests, slow down." },
});

// ✅ PUBLIC ROUTE (no auth) - Must come BEFORE adminLimiter
router.get("/public-validity/:gymId", validityLimiter, memberController.checkPublicValidity);

// Apply admin limiter to ALL remaining routes
router.use(adminLimiter);
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_")),
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB — same as /api/upload
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.match(/jpg|jpeg|png/i)) {
      return cb(new Error("Only JPG, JPEG, PNG allowed"));
    }
    cb(null, true);
  },
});

/* ============================================================
   MEMBER ROUTES
============================================================ */

// POST /api/members/register
router.post("/register", adminAuth, upload.single("photo"), validateSchema(memberRegisterSchema), memberController.registerMember);

// Registration draft (per-session) — placed before the /:gymId route so the
// literal paths never collide with the numeric gymId lookup.
router.get("/register/draft", adminAuth, draftController.getDraft);
router.put("/register/draft", adminAuth, draftController.saveDraft);
router.delete("/register/draft", adminAuth, draftController.deleteDraft);

// POST /api/members/import (Superadmin only) — bulk historical member import
router.post("/import", adminAuth, requireRole("superadmin"), memberController.importMembers);

// DELETE /api/members/:gymId
router.delete("/:gymId", adminAuth, requireRole("superadmin"), memberController.deleteMember);

// GET /api/members (all members)
router.get("/", adminAuth, memberController.getAllMembers);

// PUT /api/members/renew/:gymId
router.put("/renew/:gymId", adminAuth, validateSchema(memberRenewSchema), memberController.renewMember);

// GET /api/members/:gymId (get single member, scope-aware with memberCode disambiguation)
router.get("/:gymId", sensitiveLimiter, adminAuth, memberController.getMemberByGymId);

// PUT /api/members/:gymId (update member)
router.put("/:gymId", adminAuth, upload.single("photo"), validateSchema(memberUpdateSchema), memberController.updateMember);

export default router;
