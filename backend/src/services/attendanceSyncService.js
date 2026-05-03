import GoogleSheetsConnector from "../models/GoogleSheetsConnector.js";
import { addAttendanceEntry } from "../services/googleSheetsService.js";
import logger from "../core/logger.js";

/**
 * Sync attendance record to Google Sheets
 * Called after every successful attendance punch
 */
export const syncAttendanceToSheets = async (attendanceRecord, memberData) => {
  try {
    // Get connector
    const connector = await GoogleSheetsConnector.findOne({
      isConnected: true,
    });

    if (!connector || !connector.accessToken) {
      logger.debug("No active Google Sheets connector, skipping sync");
      return;
    }

    // Check if current year changed
    const currentYear = new Date().getFullYear();
    if (connector.yearCreated !== currentYear) {
      logger.info(`Year changed, should create new sheet for ${currentYear}`);
      // This would trigger sheet creation in next update
      // For now, continue with current sheet
    }

    // Prepare attendance data
    const attendanceData = {
      date: new Date(attendanceRecord.date).toLocaleDateString("en-GB"),
      memberId: memberData.gymId || attendanceRecord.memberId,
      memberName: memberData.fullName || memberData.name || "Unknown",
      checkInTime: attendanceRecord.checkInTime || "-",
      status: attendanceRecord.state || "completed",
      branch: memberData.branch || "",
    };

    // Add to Google Sheet
    const tokens = {
      access_token: connector.accessToken,
      refresh_token: connector.refreshToken,
    };

    const result = await addAttendanceEntry(
      tokens,
      connector.spreadsheetId,
      attendanceData
    );

    // Update sync metadata
    connector.lastSyncedAt = new Date();
    connector.lastRowIndex = result.rowIndex;
    connector.errorCount = 0;
    connector.lastError = null;
    await connector.save();

    logger.info(`Synced attendance to Google Sheets: ${memberData.gymId}`);

    return { success: true };
  } catch (error) {
    logger.error("Failed to sync attendance to Google Sheets:", error);

    // Update error tracking
    try {
      const connector = await GoogleSheetsConnector.findOne({
        isConnected: true,
      });
      if (connector) {
        connector.errorCount = (connector.errorCount || 0) + 1;
        connector.lastError = error.message;
        await connector.save();
      }
    } catch (updateError) {
      logger.error("Failed to update connector error status:", updateError);
    }

    // Don't throw - attendance should not fail if sheets sync fails
    return { success: false, error: error.message };
  }
};

/**
 * Check if we should sync to Google Sheets
 */
export const shouldSyncToSheets = async () => {
  try {
    const connector = await GoogleSheetsConnector.findOne({
      isConnected: true,
    });
    return !!(connector && connector.accessToken);
  } catch (error) {
    logger.error("Failed to check if should sync:", error);
    return false;
  }
};

/**
 * Get active connector details
 */
export const getActiveConnector = async () => {
  try {
    return await GoogleSheetsConnector.findOne({
      isConnected: true,
    });
  } catch (error) {
    logger.error("Failed to get active connector:", error);
    return null;
  }
};
