import mongoose from "mongoose";

const googleSheetsConnectorSchema = new mongoose.Schema(
  {
    // Connection details
    connectorId: {
      type: String,
      unique: true,
      default: () => "gs-" + Date.now(),
    },
    
    // Status
    isConnected: {
      type: Boolean,
      default: false,
    },
    
    // Admin email (for Google Sheets)
    adminEmail: {
      type: String,
      required: true,
      index: true,
    },
    
    // OAuth2 tokens (encrypted in production)
    accessToken: {
      type: String,
      required: false,
    },
    
    refreshToken: {
      type: String,
      required: false,
    },
    
    // Google Sheet details
    spreadsheetId: {
      type: String,
      required: false,
    },
    
    spreadsheetName: {
      type: String,
      default: "Gym Attendance",
    },
    
    sheetName: {
      type: String,
      default: "Attendance",
    },
    
    // For yearly sheets
    yearCreated: {
      type: Number,
      default: () => new Date().getFullYear(),
    },
    
    // Connection metadata
    connectedAt: {
      type: Date,
      default: null,
    },
    
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    
    lastRowIndex: {
      type: Number,
      default: 1, // First data row after header
    },
    
    // Current year's sheet
    currentSheetName: {
      type: String,
      default: null,
    },
    
    // Settings
    includeBreakBetweenDays: {
      type: Boolean,
      default: true, // Leave empty row after each day ends
    },
    
    // Error tracking
    lastError: {
      type: String,
      default: null,
    },
    
    errorCount: {
      type: Number,
      default: 0,
    },
    
    // Rate limit tracking
    dailyEntriesSynced: {
      type: Number,
      default: 0,
    },
    
    syncDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
googleSheetsConnectorSchema.index({ adminEmail: 1, isConnected: 1 });
googleSheetsConnectorSchema.index({ yearCreated: 1, isConnected: 1 });

export default mongoose.model("GoogleSheetsConnector", googleSheetsConnectorSchema);
