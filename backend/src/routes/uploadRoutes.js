// gym_project_backend/routes/uploadRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import uploadController from "../controllers/uploadController.js";
import adminAuth from "../middleware/adminAuth.js";
import { adminLimiter } from "../middleware/rateLimiter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();
router.use(adminLimiter);

/* ============================================================
   MULTER STORAGE CONFIG
   Absolute path matching express.static serving in server.js
   (backend/src/uploads). Prevents cwd-relative path mismatch.
============================================================ */
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(req, file, cb) {
    const safeName = file.originalname.replace(/\s+/g, "_").toLowerCase();
    cb(null, `${Date.now()}-${safeName}`);
  },
});

/* ============================================================
   FILE FILTER — ONLY IMAGES ALLOWED
============================================================ */
function fileFilter(req, file, cb) {
  const allowedTypes = /jpg|jpeg|png/;

  const extValid = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimeValid = allowedTypes.test(file.mimetype);

  if (extValid && mimeValid) {
    cb(null, true);
  } else {
    cb(new Error("Only JPG, JPEG, PNG files are allowed!"));
  }
}

/* ============================================================
   LIMITS — (2MB max)
============================================================ */
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

/* ============================================================
   UPLOAD ROUTES
============================================================ */

// POST /api/uploads
router.post("/", adminAuth, upload.single("photo"), uploadController.uploadPhoto);

/* ============================================================
   ERROR HANDLING (Multer errors)
============================================================ */
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message });
  }

  if (err) {
    return res.status(400).json({ message: err.message });
  }

  next();
});

export default router;
