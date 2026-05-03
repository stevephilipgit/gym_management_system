import express from "express";
import adminAuth from "../middleware/adminAuth.js";
import requireRole from "../middleware/requireRole.js";
import {
  getGoogleAuthUrl,
  handleGoogleCallback,
  getConnectionStatus,
  disconnectGoogleSheets,
  testGoogleConnection,
} from "../controllers/googleSheetsConnectorController.js";

const router = express.Router();

/**
 * Get Google OAuth2 authorization URL
 * POST /api/connectors/google-sheets/auth-url
 */
router.get("/google-sheets/auth-url", adminAuth, requireRole("superadmin"), getGoogleAuthUrl);

/**
 * Handle Google OAuth2 callback
 * POST /api/connectors/google-sheets/callback
 */
router.post("/google-sheets/callback", adminAuth, requireRole("superadmin"), handleGoogleCallback);

/**
 * Get connection status
 * GET /api/connectors/google-sheets/status
 */
router.get("/google-sheets/status", adminAuth, requireRole("superadmin"), getConnectionStatus);

/**
 * Disconnect Google Sheets
 * POST /api/connectors/google-sheets/disconnect
 */
router.post(
  "/google-sheets/disconnect",
  adminAuth,
  requireRole("superadmin"),
  disconnectGoogleSheets
);

/**
 * Test connection
 * POST /api/connectors/google-sheets/test
 */
router.post("/google-sheets/test", adminAuth, requireRole("superadmin"), testGoogleConnection);

export default router;
