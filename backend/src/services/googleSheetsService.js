import { google } from "googleapis";
import GoogleSheetsConnector from "../models/GoogleSheetsConnector.js";
import logger from "../core/logger.js";

// Google OAuth2 configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/**
 * Get authorization URL for Google OAuth2
 */
export const getAuthorizationUrl = () => {
  const scopes = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
  ];

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
  });
};

/**
 * Exchange authorization code for tokens
 */
export const getTokensFromCode = async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  } catch (error) {
    logger.error("Failed to get tokens:", error);
    throw new Error("Failed to authenticate with Google");
  }
};

/**
 * Create a new Google Sheet for attendance
 */
export const createAttendanceSheet = async (tokens, adminEmail) => {
  try {
    oauth2Client.setCredentials(tokens);
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    const year = new Date().getFullYear();
    const spreadsheetName = `Gym Attendance - ${year}`;

    // Create spreadsheet
    const response = await sheets.spreadsheets.create({
      resource: {
        properties: {
          title: spreadsheetName,
        },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: `Attendance`,
            },
          },
        ],
      },
    });

    const spreadsheetId = response.data.spreadsheetId;

    // Add header row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Attendance!A1:F1",
      valueInputOption: "RAW",
      resource: {
        values: [["Date", "Member ID", "Member Name", "Check-in Time", "Status", "Branch"]],
      },
    });

    // Format header row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 6,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: {
                    red: 0.2,
                    green: 0.2,
                    blue: 0.2,
                  },
                  textFormat: {
                    foregroundColor: {
                      red: 1,
                      green: 1,
                      blue: 1,
                    },
                    bold: true,
                  },
                  horizontalAlignment: "CENTER",
                },
              },
              fields:
                "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
            },
          },
        ],
      },
    });

    // Share with user
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            updateSpreadsheetProperties: {
              properties: {
                defaultFormat: {
                  padding: {
                    top: 2,
                    bottom: 2,
                    left: 3,
                    right: 3,
                  },
                },
              },
              fields: "defaultFormat",
            },
          },
        ],
      },
    });

    logger.info(`Created Google Sheet: ${spreadsheetId}`);

    return {
      spreadsheetId,
      spreadsheetName,
      sheetName: "Attendance",
    };
  } catch (error) {
    logger.error("Failed to create sheet:", error);
    throw error;
  }
};

/**
 * Add attendance entry to Google Sheet
 */
export const addAttendanceEntry = async (tokens, spreadsheetId, attendanceData) => {
  try {
    oauth2Client.setCredentials(tokens);
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    const { date, memberId, memberName, checkInTime, status, branch } = attendanceData;

    // Get current sheet data to find next row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Attendance!A:A",
    });

    const values = response.data.values || [];
    let nextRow = values.length + 1;

    // Keep one empty separator row between days.
    // Header is row 1, data starts row 2.
    if (values.length > 1) {
      const lastDateCell = values[values.length - 1]?.[0] || "";
      const currentDateCell = String(date || "").trim();

      if (lastDateCell && currentDateCell && lastDateCell !== currentDateCell) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Attendance!A${nextRow}:F${nextRow}`,
          valueInputOption: "RAW",
          resource: {
            values: [["", "", "", "", "", ""]],
          },
        });
        nextRow += 1;
      }
    }

    // Append row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Attendance!A${nextRow}:F${nextRow}`,
      valueInputOption: "RAW",
      resource: {
        values: [[date, memberId, memberName, checkInTime, status, branch || ""]],
      },
    });

    logger.info(`Added attendance entry to Google Sheet: ${memberId}`);

    return { success: true, rowIndex: nextRow };
  } catch (error) {
    logger.error("Failed to add attendance entry:", error);
    throw error;
  }
};

/**
 * Get connector details
 */
export const getConnector = async (adminEmail) => {
  try {
    const connector = await GoogleSheetsConnector.findOne({
      adminEmail,
      isConnected: true,
    });
    return connector;
  } catch (error) {
    logger.error("Failed to get connector:", error);
    throw error;
  }
};

/**
 * Save connector details
 */
export const saveConnector = async (adminEmail, connectorData) => {
  try {
    let connector = await GoogleSheetsConnector.findOne({ adminEmail });

    if (!connector) {
      connector = new GoogleSheetsConnector({
        adminEmail,
        ...connectorData,
      });
    } else {
      Object.assign(connector, connectorData);
    }

    await connector.save();
    return connector;
  } catch (error) {
    logger.error("Failed to save connector:", error);
    throw error;
  }
};

/**
 * Disconnect Google Sheets
 */
export const disconnectSheets = async (adminEmail) => {
  try {
    const connector = await GoogleSheetsConnector.findOne({ adminEmail });

    if (connector) {
      connector.isConnected = false;
      connector.accessToken = null;
      connector.refreshToken = null;
      connector.lastError = null;
      await connector.save();
    }

    logger.info(`Disconnected Google Sheets for: ${adminEmail}`);
    return true;
  } catch (error) {
    logger.error("Failed to disconnect sheets:", error);
    throw error;
  }
};

/**
 * Test connection
 */
export const testConnection = async (tokens) => {
  try {
    oauth2Client.setCredentials(tokens);
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    // Try to list spreadsheets
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const result = await drive.files.list({
      pageSize: 1,
      fields: "files(id, name)",
    });

    return {
      success: true,
      message: "Connection successful",
    };
  } catch (error) {
    logger.error("Connection test failed:", error);
    return {
      success: false,
      message: error.message,
    };
  }
};
