import apiClient from "./apiClient";

/**
 * Get Google OAuth authorization URL
 */
export const getGoogleAuthUrl = async () => {
  try {
    const response = await apiClient.get("/connectors/google-sheets/auth-url");
    return response.data?.authUrl;
  } catch (error) {
    console.error("Failed to get auth URL:", error);
    throw error;
  }
};

/**
 * Handle Google OAuth callback
 */
export const connectGoogleSheets = async (code, adminEmail) => {
  try {
    const response = await apiClient.post("/connectors/google-sheets/callback", {
      code,
      adminEmail,
    });
    return response.data;
  } catch (error) {
    console.error("Failed to connect:", error);
    throw error;
  }
};

/**
 * Get connection status
 */
export const getConnectionStatus = async () => {
  try {
    const response = await apiClient.get("/connectors/google-sheets/status");
    return response.data;
  } catch (error) {
    console.error("Failed to get status:", error);
    throw error;
  }
};

/**
 * Disconnect Google Sheets
 */
export const disconnectGoogleSheets = async () => {
  try {
    const response = await apiClient.post("/connectors/google-sheets/disconnect");
    return response.data;
  } catch (error) {
    console.error("Failed to disconnect:", error);
    throw error;
  }
};

/**
 * Test Google Sheets connection
 */
export const testGoogleSheetsConnection = async () => {
  try {
    const response = await apiClient.post("/connectors/google-sheets/test");
    return response.data;
  } catch (error) {
    console.error("Connection test failed:", error);
    throw error;
  }
};

/**
 * Open Google OAuth consent screen
 */
export const openGoogleAuthFlow = async () => {
  try {
    const authUrl = await getGoogleAuthUrl();
    if (authUrl) {
      window.open(authUrl, "googleAuth", "width=600,height=600");
    }
  } catch (error) {
    console.error("Failed to open auth flow:", error);
    throw error;
  }
};
