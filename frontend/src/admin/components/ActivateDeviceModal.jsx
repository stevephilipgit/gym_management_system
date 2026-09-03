import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FiCamera, FiCheckCircle, FiEye, FiEyeOff, FiHash, FiInfo, FiLock, FiSmartphone, FiX } from "react-icons/fi";

// Polished, compact modal for activating a Trainer attendance device.
// UI-only refactor of the inline modal in AttendanceMyDevices.jsx.
// Reuses the existing CSS classes (.modal-shell / .modal-card / .modal-header /
// .modal-content / .modal-error / .modal-button-row / .icon-close-btn / .kiosk-input)
// and react-icons/fi for consistency with the rest of the admin app.

function SegmentedTabs({ value, onChange, disabled, options }) {
  return (
    <div className="adm-segmented" role="tablist" aria-label="Activation method">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={opt.controls}
            id={`tab-${opt.value}`}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`adm-segmented__btn${active ? " is-active" : ""}`}
          >
            <span className="adm-segmented__icon" aria-hidden="true">{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function QrScanInput({ onSecret, disabled }) {
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scannerRef = useRef(null);

  // Native BarcodeDetector — Chromium-only. Safari/iOS/Firefox fall back to
  // the 6-Digit Code tab (same activation, same lifecycle).
  const detectorSupported =
    typeof window !== "undefined" && typeof window.BarcodeDetector !== "undefined";

  const stopScan = useCallback(() => {
    if (scannerRef.current) {
      try { clearInterval(scannerRef.current); } catch { /* noop */ }
      scannerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => () => stopScan(), [stopScan]);

  const startScan = async () => {
    setScanError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      scannerRef.current = setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && codes[0].rawValue) {
            const value = String(codes[0].rawValue).trim();
            onSecret(value);
            stopScan();
          }
        } catch {
          setScanError("Could not read the QR. Hold it steady and try again.");
        }
      }, 500);
      setScanning(true);
    } catch {
      setScanError("Camera unavailable or permission denied. Use the 6-Digit Code tab instead.");
      setScanning(false);
    }
  };

  if (!detectorSupported) {
    return (
      <div className="adm-activate-modal__notice" role="note">
        <FiInfo aria-hidden="true" className="adm-activate-modal__notice-icon" />
        <div>
          <div className="adm-activate-modal__notice-title">Scanner unavailable</div>
          <p className="adm-activate-modal__notice-body">
            QR scanning isn&apos;t supported in this browser. Switch to the 6-Digit
            Code tab — it activates the same device through the same secure flow.
          </p>
        </div>
      </div>
    );
  }

  if (scanning) {
    return (
      <div className="adm-qr-scan">
        <video ref={videoRef} className="adm-qr-video" muted playsInline />
        {scanError ? <div className="modal-error" role="alert">{scanError}</div> : null}
        <div className="adm-qr-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={stopScan}
            disabled={disabled}
          >
            Cancel Scan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="adm-qr-scan">
      <p className="adm-helper">
        Point this device&apos;s camera at the QR code your administrator shared.
      </p>
      {scanError ? <div className="modal-error" role="alert">{scanError}</div> : null}
      <div className="adm-qr-actions">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={startScan}
          disabled={disabled}
        >
          <FiCamera aria-hidden="true" />
          <span>Scan QR Code</span>
        </button>
      </div>
    </div>
  );
}

function PasswordField({ value, onChange, disabled }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="adm-field">
      <label htmlFor="adm-password" className="adm-label">Confirm with your password</label>
      <div className="adm-input-wrap">
        <input
          id="adm-password"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          className="kiosk-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="Your login password"
        />
        <button
          type="button"
          className="adm-input-icon-btn"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          title={visible ? "Hide password" : "Show password"}
        >
          {visible ? <FiEyeOff /> : <FiEye />}
        </button>
      </div>
    </div>
  );
}

export default function ActivateDeviceModal({
  open,
  onClose,
  onActivate,
}) {
  const [mode, setMode] = useState("code"); // "code" | "qr"
  const [step, setStep] = useState("code"); // code | password | activating
  const [code, setCode] = useState("");
  const [qrSecret, setQrSecret] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const codeInputRef = useRef(null);
  const titleId = useId();

  // Focus the code input on first render
  useEffect(() => {
    const t = setTimeout(() => codeInputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  // Close on Escape + focus trap-lite: focus the close button first
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleCodeChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setError("");
    if (digits.length === 6 && step === "code") {
      setStep("password");
      setTimeout(() => {
        const el = document.getElementById("adm-password");
        if (el) el.focus();
      }, 50);
    }
  };

  const selectMode = (next) => {
    setMode(next);
    setCode("");
    setQrSecret("");
    setError("");
    if (next === "code") {
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
  };

  const codeComplete = mode === "code" && code.length === 6 && /^\d{6}$/.test(code);
  const qrComplete = mode === "qr" && qrSecret.length > 0;
  const ready = (codeComplete || qrComplete) && password.length > 0;

  const submit = async () => {
    if (step === "activating") return;
    if (!ready) {
      setError(
        mode === "code"
          ? "Enter the 6-digit code and your password."
          : "Enter or scan the QR value and your password."
      );
      return;
    }
    setStep("activating");
    setError("");
    try {
      await onActivate({ mode, code, qrSecret, password });
    } catch (err) {
      setStep("password");
      setError(
        err?.response?.data?.message || err?.message || "Activation failed. Check the code and try again."
      );
    }
  };

  if (!open) return null;

  const activating = step === "activating";

  return (
    <div className="modal-shell" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div
        className="modal-card adm-activate-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header adm-activate-modal__header">
          <div className="adm-activate-modal__title-block">
            <span className="adm-activate-modal__icon" aria-hidden="true">
              <FiSmartphone />
            </span>
            <div>
              <h2 id={titleId} className="adm-activate-modal__title">Activate Attendance Device</h2>
              <p className="adm-activate-modal__subtitle">
                Use the one-time code or QR from your administrator.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-close-btn"
            onClick={onClose}
            disabled={activating}
            aria-label="Close activation dialog"
            title="Close"
          >
            <FiX aria-hidden="true" />
          </button>
        </div>

        <div className="modal-content adm-activate-modal__content">
          {error ? (
            <div className="modal-error" role="alert">{error}</div>
          ) : null}

          <SegmentedTabs
            value={mode}
            onChange={selectMode}
            disabled={activating}
            options={[
              { value: "code", label: "6-Digit Code", icon: <FiHash />, controls: "adm-panel-code" },
              { value: "qr", label: "QR Code", icon: <FiSmartphone />, controls: "adm-panel-qr" },
            ]}
          />

          <div className="adm-activate-modal__body">
            {mode === "code" ? (
              <div
                role="tabpanel"
                id="adm-panel-code"
                aria-labelledby="tab-code"
                className="adm-field"
              >
                <label htmlFor="adm-code" className="adm-label">6-Digit Code</label>
                <input
                  id="adm-code"
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  className="kiosk-input adm-code-input"
                  value={code}
                  onChange={handleCodeChange}
                  disabled={activating}
                  placeholder="000000"
                  aria-label="6-digit activation code"
                />
                <p className="adm-helper">Type the 6-digit code your administrator gave you.</p>
              </div>
            ) : (
              <div role="tabpanel" id="adm-panel-qr" aria-labelledby="tab-qr" className="adm-field">
                <QrScanInput onSecret={(v) => { setQrSecret(v); setError(""); }} disabled={activating} />
                {qrSecret ? (
                  <p className="adm-helper" style={{ margin: 0, color: "var(--success)" }}>
                    QR captured. Confirm your password below to activate.
                  </p>
                ) : null}
              </div>
            )}

            {(codeComplete || qrComplete) ? (
              <div className="adm-activate-modal__password">
                <PasswordField
                  value={password}
                  onChange={(v) => { setPassword(v); setError(""); }}
                  disabled={activating}
                />
              </div>
            ) : null}

            <div className="adm-activate-modal__notice" role="note">
                <FiInfo aria-hidden="true" className="adm-activate-modal__notice-icon" />
                <div>
                  <div className="adm-activate-modal__notice-title">Important</div>
                  <p className="adm-activate-modal__notice-body">
                    Make sure you're on the device you want to use for attendance. Activating a new
                    device will deactivate your previous attendance device. This action cannot be undone.
                  </p>
                </div>
              </div>
          </div>

          <div className="modal-button-row adm-activate-modal__actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={activating || !ready}
              aria-busy={activating}
            >
              {activating ? (
                <>
                  <FiLock aria-hidden="true" />
                  <span>Activating…</span>
                </>
              ) : (
                <>
                  <FiCheckCircle aria-hidden="true" />
                  <span>Activate Device</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}