import { google } from "googleapis";
import GoogleSheetsConnector from "../models/GoogleSheetsConnector.js";
import logger from "../core/logger.js";
import config from "../config/index.js";

let authClient = null;

const getAuth = () => {
  if (!config.google.enabled) {
    return null;
  }
  if (!authClient) {
    authClient = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.google.clientEmail,
        private_key: config.google.privateKey?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
    });
  }
  return authClient;
};

/**
 * Get authorization URL for Google OAuth2
 */
export const getAuthorizationUrl = () => {
  return ""; // Deprecated
};

/**
 * Exchange authorization code for tokens
 */
export const getTokensFromCode = async (code) => {
  return {}; // Deprecated
};

/**
 * Create a new Google Sheet for attendance
 */
export const createAttendanceSheet = async (tokens, adminEmail) => {
  try {
    const auth = getAuth();
    if (!auth) {
      logger.warn('[Sheets] Skipping sync — sheets not configured.');
      return;
    }
    const sheets = google.sheets({ version: "v4", auth });

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
export const addAttendanceEntry = async (tokens, _spreadsheetId, attendanceData) => {
  try {
    const auth = getAuth();
    if (!auth) {
      logger.warn('[Sheets] Skipping sync — sheets not configured.');
      return { success: false };
    }
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = config.google.sheetId || _spreadsheetId;

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

export const saveConnector = async (adminEmail, data) => {
  return await GoogleSheetsConnector.findOneAndUpdate(
    { adminEmail },
    { ...data, adminEmail },
    { new: true, upsert: true }
  );
};

export const getConnector = async (adminEmail) => {
  return await GoogleSheetsConnector.findOne({ adminEmail });
};

export const disconnectSheets = async (adminEmail) => {
  return await GoogleSheetsConnector.deleteOne({ adminEmail });
};

export const addEnquiryEntry = async (tokens, _spreadsheetId, enquiryData) => {
  try {
    const auth = getAuth();
    if (!auth) {
      logger.warn('[Sheets] Skipping sync — sheets not configured.');
      return { success: false };
    }
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = config.google.sheetId || _spreadsheetId;

    const { date, name, email, phone, branch, reason, message } = enquiryData;

    // Check if Enquiries sheet exists, if not create it
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetExists = spreadsheet.data.sheets.some((s) => s.properties.title === "Enquiries");

    let newSheetId = null;

    if (!sheetExists) {
      const addSheetRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{ addSheet: { properties: { title: "Enquiries" } } }]
        }
      });
      newSheetId = addSheetRes.data.replies[0].addSheet.properties.sheetId;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Enquiries!A1:G1",
        valueInputOption: "RAW",
        resource: { values: [["Date", "Name", "Email", "Phone", "Branch", "Reason", "Message"]] }
      });

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              repeatCell: {
                range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
                    textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                    horizontalAlignment: "CENTER"
                  }
                },
                fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
              }
            }
          ]
        }
      });
    }

    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Enquiries!A:A" });
    const values = response.data.values || [];
    const nextRow = values.length + 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Enquiries!A${nextRow}:G${nextRow}`,
      valueInputOption: "RAW",
      resource: { values: [[date, name, email, phone, branch, reason, message || ""]] }
    });

    logger.info(`Added enquiry entry to Google Sheet: ${email}`);
    return { success: true, rowIndex: nextRow };
  } catch (error) {
    logger.error("Failed to add enquiry entry:", error);
    throw error;
  }
};
export const testConnection = async (tokens) => {
  try {
    const auth = getAuth();
    if (!auth) {
      return { success: false, message: "Sheets not configured" };
    }
    const sheets = google.sheets({ version: "v4", auth });

    // Try to list spreadsheets
    const drive = google.drive({ version: "v3", auth });
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
