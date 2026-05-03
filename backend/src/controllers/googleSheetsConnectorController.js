import GoogleSheetsConnector from "../models/GoogleSheetsConnector.js";
import {
  getAuthorizationUrl,
  getTokensFromCode,
  createAttendanceSheet,
  saveConnector,
  getConnector,
  disconnectSheets,
  testConnection,
} from "../services/googleSheetsService.js";
import logger from "../core/logger.js";

/**
 * GET /api/connectors/google-sheets/auth-url
 * Get Google OAuth2 authorization URL
 */
export const getGoogleAuthUrl = async (req, res) => {
  try {
    const authUrl = getAuthorizationUrl();
    res.json({
      success: true,
      authUrl,
    });
  } catch (error) {
    logger.error("Failed to get auth URL:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get authorization URL",
    });
  }
};

/**
 * POST /api/connectors/google-sheets/callback
 * Handle Google OAuth2 callback
 */
export const handleGoogleCallback = async (req, res) => {
  try {
    const { code, adminEmail } = req.body;

    if (!code || !adminEmail) {
      return res.status(400).json({
        success: false,
        message: "Missing code or adminEmail",
      });
    }

    // Get tokens
    const tokens = await getTokensFromCode(code);

    // Create sheet
    const sheetDetails = await createAttendanceSheet(tokens, adminEmail);

    // Save connector
    const connector = await saveConnector(adminEmail, {
      isConnected: true,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      spreadsheetId: sheetDetails.spreadsheetId,
      spreadsheetName: sheetDetails.spreadsheetName,
      sheetName: sheetDetails.sheetName,
      connectedAt: new Date(),
      lastError: null,
    });

    logger.info(`Google Sheets connected for: ${adminEmail}`);

    res.json({
      success: true,
      message: "Google Sheets connected successfully",
      connector: {
        spreadsheetName: connector.spreadsheetName,
        spreadsheetId: connector.spreadsheetId,
        connectedAt: connector.connectedAt,
      },
    });
  } catch (error) {
    logger.error("Failed to handle Google callback:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to connect Google Sheets",
    });
  }
};

/**
 * GET /api/connectors/google-sheets/status
 * Get connection status
 */
export const getConnectionStatus = async (req, res) => {
  try {
    const adminEmail = req.user?.email || req.admin?.email;

    if (!adminEmail) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    const connector = await GoogleSheetsConnector.findOne({
      adminEmail,
    });

    if (!connector) {
      return res.json({
        success: true,
        isConnected: false,
        connector: null,
      });
    }

    res.json({
      success: true,
      isConnected: connector.isConnected,
      connector: {
        spreadsheetName: connector.spreadsheetName,
        spreadsheetId: connector.spreadsheetId,
        connectedAt: connector.connectedAt,
        lastSyncedAt: connector.lastSyncedAt,
        yearCreated: connector.yearCreated,
      },
    });
  } catch (error) {
    logger.error("Failed to get connection status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get connection status",
    });
  }
};

/**
 * POST /api/connectors/google-sheets/disconnect
 * Disconnect Google Sheets
 */
export const disconnectGoogleSheets = async (req, res) => {
  try {
    const adminEmail = req.user?.email || req.admin?.email;

    if (!adminEmail) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    await disconnectSheets(adminEmail);

    logger.info(`Disconnected Google Sheets for: ${adminEmail}`);

    res.json({
      success: true,
      message: "Google Sheets disconnected successfully",
    });
  } catch (error) {
    logger.error("Failed to disconnect sheets:", error);
    res.status(500).json({
      success: false,
      message: "Failed to disconnect Google Sheets",
    });
  }
};

/**
 * POST /api/connectors/google-sheets/test
 * Test connection
 */
export const testGoogleConnection = async (req, res) => {
  try {
    const adminEmail = req.user?.email || req.admin?.email;

    if (!adminEmail) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    const connector = await GoogleSheetsConnector.findOne({
      adminEmail,
      isConnected: true,
    });

    if (!connector || !connector.accessToken) {
      return res.status(400).json({
        success: false,
        message: "No active Google Sheets connection",
      });
    }

    const tokens = {
      access_token: connector.accessToken,
      refresh_token: connector.refreshToken,
    };

    const result = await testConnection(tokens);

    res.json({
      success: result.success,
      message: result.message,
    });
  } catch (error) {
    logger.error("Connection test failed:", error);
    res.status(500).json({
      success: false,
      message: "Connection test failed",
    });
  }
};
