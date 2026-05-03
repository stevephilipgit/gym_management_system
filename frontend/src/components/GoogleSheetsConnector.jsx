import { useEffect, useState } from "react";
import {
  getConnectionStatus,
  disconnectGoogleSheets,
  testGoogleSheetsConnection,
  openGoogleAuthFlow,
} from "../utils/googleSheetsClient";

export const GoogleSheetsConnector = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [connector, setConnector] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    loadConnectionStatus();
  }, []);

  const loadConnectionStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getConnectionStatus();
      setIsConnected(data.isConnected);
      setConnector(data.connector);
    } catch (err) {
      console.error("Failed to load connection status:", err);
      setError("Failed to load connection status");
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      setError(null);
      setSuccess(null);
      await openGoogleAuthFlow();
      
      // Reload status after a delay (user should close the popup after connecting)
      setTimeout(() => {
        loadConnectionStatus();
      }, 2000);
    } catch (err) {
      console.error("Failed to connect:", err);
      setError("Failed to initiate connection. Please try again.");
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Are you sure you want to disconnect Google Sheets?")) {
      return;
    }

    try {
      setError(null);
      await disconnectGoogleSheets();
      setSuccess("Google Sheets disconnected successfully");
      setIsConnected(false);
      setConnector(null);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error("Failed to disconnect:", err);
      setError("Failed to disconnect. Please try again.");
    }
  };

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setError(null);
      const result = await testGoogleSheetsConnection();
      if (result.success) {
        setSuccess("Connection test successful!");
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(result.message || "Connection test failed");
      }
    } catch (err) {
      console.error("Connection test failed:", err);
      setError("Connection test failed. Please try again.");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="panel">
        <div className="section-heading">
          <span className="eyebrow">Google Sheets Integration</span>
          <h3 className="panel-title">Loading...</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="section-heading">
        <span className="eyebrow">Integrations</span>
        <h3 className="panel-title">Google Sheets Connector</h3>
        <p className="panel-subtitle">
          Connect your gym attendance records to Google Sheets for automatic syncing
        </p>
      </div>

      <div className="section-stack mt-6" style={{ gap: "20px" }}>
        {/* Status Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px",
            backgroundColor: isConnected ? "#f0f8f0" : "#f8f8f8",
            borderRadius: "8px",
            border: `2px solid ${isConnected ? "#2ecc71" : "#ddd"}`,
          }}
        >
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              backgroundColor: isConnected ? "#2ecc71" : "#999",
            }}
          />
          <div>
            <p style={{ fontWeight: "bold", margin: "0" }}>
              {isConnected ? "Connected" : "Not Connected"}
            </p>
            {connector && (
              <p
                style={{
                  fontSize: "12px",
                  color: "#666",
                  margin: "4px 0 0 0",
                }}
              >
                Sheet: {connector.spreadsheetName}
              </p>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div
            style={{
              padding: "12px",
              backgroundColor: "#fee",
              borderLeft: "4px solid #c33",
              borderRadius: "4px",
              color: "#c33",
              fontSize: "14px",
            }}
          >
            {error}
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div
            style={{
              padding: "12px",
              backgroundColor: "#efe",
              borderLeft: "4px solid #2ecc71",
              borderRadius: "4px",
              color: "#2ecc71",
              fontSize: "14px",
            }}
          >
            {success}
          </div>
        )}

        {/* Connection Details */}
        {isConnected && connector && (
          <div
            style={{
              padding: "16px",
              backgroundColor: "#f9f9f9",
              borderRadius: "8px",
              border: "1px solid #ddd",
            }}
          >
            <h4 style={{ margin: "0 0 12px 0" }}>Connection Details</h4>
            <div style={{ fontSize: "14px", lineHeight: "1.6" }}>
              <p style={{ margin: "4px 0" }}>
                <strong>Sheet Name:</strong> {connector.spreadsheetName}
              </p>
              <p style={{ margin: "4px 0" }}>
                <strong>Sheet ID:</strong>{" "}
                <code
                  style={{
                    padding: "2px 6px",
                    backgroundColor: "#eee",
                    borderRadius: "3px",
                    fontSize: "12px",
                  }}
                >
                  {connector.spreadsheetId}
                </code>
              </p>
              <p style={{ margin: "4px 0" }}>
                <strong>Connected:</strong>{" "}
                {new Date(connector.connectedAt).toLocaleDateString()}
              </p>
              {connector.lastSyncedAt && (
                <p style={{ margin: "4px 0" }}>
                  <strong>Last Synced:</strong>{" "}
                  {new Date(connector.lastSyncedAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {!isConnected ? (
            <button onClick={handleConnect} className="btn-primary">
              Connect Google Sheets
            </button>
          ) : (
            <>
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="btn-secondary"
              >
                {testing ? "Testing..." : "Test Connection"}
              </button>
              <button onClick={handleDisconnect} className="btn-danger">
                Disconnect
              </button>
            </>
          )}
        </div>

        {/* Info Section */}
        <div
          style={{
            padding: "12px",
            backgroundColor: "#f0f8ff",
            borderLeft: "4px solid #0066cc",
            borderRadius: "4px",
            fontSize: "13px",
            lineHeight: "1.5",
          }}
        >
          <p style={{ margin: "0 0 8px 0", fontWeight: "bold" }}>
            ℹ️ How it works:
          </p>
          <ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
            <li>Connect your Google account to create a linked spreadsheet</li>
            <li>
              Attendance entries will automatically sync to the Google Sheet
            </li>
            <li>Each year gets its own sheet for better organization</li>
            <li>
              You can view, edit, and share the sheet directly on Google Drive
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};
