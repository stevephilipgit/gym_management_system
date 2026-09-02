import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../utils/apiClient.js";
import {
  getOrCreateBrowserDeviceId,
  setKioskIdentity,
  clearKioskIdentity,
} from "../utils/kioskIdentity.js";
import {
  PageHeader,
  SectionHeader,
  StatusBadge,
  EmptyState,
} from "./components/ui/DeviceComponents.jsx";

function fmt(dt) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString();
}

function scopeLabel(scope) {
  return scope === "male"
    ? "Male"
    : scope === "female_plus_transgender"
    ? "Female + Transgender"
    : scope || "—";
}

// Simple, dependency-free QR scan using the native Barcode Detection API
// (Chromium on secure contexts). Falls back gracefully to manual paste.
function QrScanInput({ onSecret, disabled }) {
  const [mode, setMode] = useState("manual"); // "manual" | "scan"
  const [secret, setSecret] = useState("");
  const [scanError, setScanError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scannerRef = useRef(null);

  const stopScan = useCallback(() => {
    if (scannerRef.current) {
      try { scannerRef.current.stop(); } catch { /* noop */ }
      scannerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setMode("manual");
  }, []);

  useEffect(() => () => stopScan(), [stopScan]);

  const startScan = async () => {
    setScanError("");
    if (typeof BarcodeDetector === "undefined") {
      setScanError("QR scanning is not supported on this browser. Paste the QR value below instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      scannerRef.current = setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && codes[0].rawValue) {
            const value = String(codes[0].rawValue).trim();
            setSecret(value);
            onSecret(value);
            stopScan();
          }
        } catch (err) {
          setScanError("Could not read QR. Ensure the QR is clearly visible.");
        }
      }, 500);
      setMode("scan");
    } catch (err) {
      setScanError("Camera access denied. Paste the QR value below instead.");
    }
  };

  if (mode === "scan") {
    return (
      <div style={{ marginTop: 4 }}>
        <video ref={videoRef} style={{ width: "100%", borderRadius: 8, maxHeight: 220, objectFit: "cover" }} muted playsInline />
        {scanError ? <div className="modal-error">{scanError}</div> : null}
        <div className="modal-button-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={stopScan} disabled={disabled}>
            Cancel Scan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        QR Activation Value
      </label>
      <input
        type="text"
        autoComplete="off"
        className="kiosk-input"
        style={{ marginTop: 4 }}
        value={secret}
        onChange={(e) => {
          setSecret(e.target.value);
          onSecret(e.target.value.trim());
        }}
        disabled={disabled}
        placeholder="Paste the QR value from your administrator"
        aria-label="QR activation value"
      />
      {scanError ? <div className="modal-error">{scanError}</div> : null}
      <div className="modal-button-row" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={startScan} disabled={disabled}>
          Scan QR
        </button>
      </div>
    </div>
  );
}

export default function AttendanceMyDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyAction, setBusyAction] = useState(null);

  // Activation modal state
  const [activationOpen, setActivationOpen] = useState(false);
  const [mode, setMode] = useState("code"); // "code" | "qr"
  const [step, setStep] = useState("code"); // code | password | activating
  const [code, setCode] = useState("");
  const [qrSecret, setQrSecret] = useState("");
  const [password, setPassword] = useState("");
  const [activationError, setActivationError] = useState("");

  const browserDeviceId = getOrCreateBrowserDeviceId();
  const codeInputRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient.get("/admin/devices/my");
      setDevices(res.data?.registrations || res.data?.activations || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load your attendance devices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openActivation = () => {
    setActivationOpen(true);
    setMode("code");
    setStep("code");
    setCode("");
    setQrSecret("");
    setPassword("");
    setActivationError("");
    setError("");
    setSuccess("");
    setTimeout(() => codeInputRef.current?.focus(), 100);
  };

  const closeActivation = () => {
    setActivationOpen(false);
    setMode("code");
    setStep("code");
    setCode("");
    setQrSecret("");
    setPassword("");
    setActivationError("");
  };

  const handleCodeChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && step === "code") {
      setStep("password");
    }
  };

  const selectMode = (nextMode) => {
    setMode(nextMode);
    setCode("");
    setQrSecret("");
    setActivationError("");
    if (nextMode === "code") {
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
  };

  const activate = async () => {
    const hasCode = mode === "code" && code && code.length === 6;
    const hasQr = mode === "qr" && qrSecret && qrSecret.length > 0;
    if (!hasCode && !hasQr) {
      setActivationError(
        mode === "code"
          ? "Enter the 6-digit code and your password."
          : "Enter or scan the QR value and your password."
      );
      return;
    }
    if (!password) {
      setActivationError("Confirm with your password.");
      return;
    }
    setStep("activating");
    setActivationError("");
    try {
      const res = await apiClient.post("/admin/devices/activate", {
        code: mode === "code" ? code : undefined,
        qrSecret: mode === "qr" ? qrSecret : undefined,
        password,
        browserDeviceId,
      });
      const { registration, apiKey } = res.data || {};
      if (registration?.kioskId && apiKey) {
        setKioskIdentity(registration.kioskId, apiKey);
      }
      closeActivation();
      setSuccess("Device activated. The customer attendance page is now ready.");
      await fetchData();
    } catch (err) {
      setStep("password");
      setActivationError(
        err?.response?.data?.message || "Activation failed. Check the code and try again."
      );
    }
  };

  const lockDevice = async (registrationId) => {
    if (busyAction) return;
    setBusyAction(`lock-${registrationId}`);
    setError("");
    setSuccess("");
    try {
      await apiClient.post(`/admin/devices/${registrationId}/deactivate`);
      // This browser's attendance credential is no longer valid.
      clearKioskIdentity();
      setSuccess("Device locked. The customer attendance page is disabled on this browser.");
      await fetchData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to lock the device.");
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return <div className="page-content"><p className="muted-copy">Loading your devices...</p></div>;
  }

  const activeDevice = devices.find((d) => d.active);
  const inactiveDevices = devices.filter((d) => !d.active);

  return (
    <div className="page-content">
      <PageHeader
        title="My Attendance Device"
        description="Manage the device you use for customer attendance."
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      <SectionHeader title="Current Device" />
      {activeDevice ? (
        <div className="admin-device-card device-active">
          <div className="admin-device-info">
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              This browser is your active attendance device
            </h3>
            <StatusBadge label="Active" cls="badge-active" />
            <span className="muted-copy" style={{ fontSize: 12 }}>
              Scope: {scopeLabel(activeDevice.scope)}
            </span>
            <span className="muted-copy" style={{ fontSize: 12 }}>
              Activated {fmt(activeDevice.activatedAt)}
            </span>
          </div>
          <div className="device-card-actions">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busyAction === `lock-${activeDevice.registrationId}`}
              onClick={() => lockDevice(activeDevice.registrationId)}
            >
              {busyAction === `lock-${activeDevice.registrationId}` ? "Locking..." : "Lock / Deactivate"}
            </button>
          </div>
        </div>
      ) : (
        <EmptyState
          title="No active device"
          description="Ask the gym administrator to generate an activation code, then enter it below."
        >
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={openActivation}>
              Activate Attendance Device
            </button>
          </div>
        </EmptyState>
      )}

      {inactiveDevices.length > 0 ? (
        <>
          <SectionHeader title="Previous Devices" sub="Locked or replaced devices." style={{ marginTop: 24 }} />
          <div className="admin-device-grid">
            {inactiveDevices.slice(0, 5).map((d) => (
              <div key={d.registrationId} className="admin-device-card">
                <div className="admin-device-info">
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Previous device</h3>
                  <StatusBadge label="Locked" cls="badge-muted" />
                  <span className="muted-copy" style={{ fontSize: 12 }}>
                    {fmt(d.deactivatedAt || d.revokedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {activeDevice ? (
        <div style={{ marginTop: 24 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={openActivation}>
            Replace Device
          </button>
          <p className="muted-copy" style={{ fontSize: 11, marginTop: 6 }}>
            Activating a new device will deactivate your previous attendance device.
          </p>
        </div>
      ) : null}

      {activationOpen ? (
        <div className="modal-shell" onClick={closeActivation}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Activate Attendance Device</h2>
                <p className="muted-copy" style={{ margin: "2px 0 0", fontSize: 13 }}>
                  Use the one-time code from your administrator.
                </p>
              </div>
              <button type="button" className="icon-close-btn" onClick={closeActivation} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal-content">
              {activationError ? <div className="modal-error">{activationError}</div> : null}

              {/* Mode tabs: 6-digit code OR QR */}
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button
                  type="button"
                  className={mode === "code" ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm"}
                  onClick={() => selectMode("code")}
                  disabled={step === "activating"}
                >
                  6-Digit Code
                </button>
                <button
                  type="button"
                  className={mode === "qr" ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm"}
                  onClick={() => selectMode("qr")}
                  disabled={step === "activating"}
                >
                  QR Code
                </button>
              </div>

              {mode === "code" ? (
                <>
                  <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    6-Digit Code
                  </label>
                  <input
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    autoComplete="one-time-code"
                    className="kiosk-input"
                    style={{ fontSize: 22, letterSpacing: "0.4em", textAlign: "center", marginTop: 4 }}
                    value={code}
                    onChange={handleCodeChange}
                    disabled={step === "activating"}
                    placeholder="••••••"
                    aria-label="6-digit activation code"
                  />
                </>
              ) : (
                <QrScanInput onSecret={(v) => setQrSecret(v)} disabled={step === "activating"} />
              )}

              {(step === "password" || step === "activating") ? (
                <>
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      marginTop: 14,
                      display: "block",
                    }}
                  >
                    Confirm with your password
                  </label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    className="kiosk-input"
                    style={{ marginTop: 4 }}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={step === "activating"}
                    placeholder="Your login password"
                    aria-label="Password"
                  />
                </>
              ) : null}

              <p className="muted-copy" style={{ fontSize: 11, marginTop: 10 }}>
                Activating a new device will deactivate your previous attendance device.
              </p>

              <div className="modal-button-row">
                <button type="button" className="btn btn-outline btn-sm" onClick={closeActivation} disabled={step === "activating"}>
                  Cancel
                </button>
                {(step === "password" || step === "activating") ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={activate}
                    disabled={step === "activating" || !password || (mode === "code" ? !code || code.length !== 6 : !qrSecret)}
                  >
                    {step === "activating" ? "Activating..." : "Activate"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}