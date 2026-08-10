import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../utils/apiClient.js";
import PunchModal from "../components/PunchModal.jsx";

const KIOSK_PIN_ENABLED = false;
const KIOSK_PIN = "2580";
const COOLDOWN_MS = 2500;

function sanitizeInput(raw) {
  if (!raw) return "";
  return String(raw).trim().replace(/\D/g, "");
}

function validateInput(input) {
  const clean = sanitizeInput(input);
  if (!clean) return { valid: false, error: "Enter Gym ID or Phone Number" };
  if (clean.length > 10) return { valid: false, error: "Phone must be 10 digits or use Gym ID" };
  if (/^[6-9]\d{9}$/.test(clean)) return { valid: true, error: null };
  if (parseInt(clean, 10) > 0) return { valid: true, error: null };
  return { valid: false, error: "Invalid input" };
}

export default function KioskAttendance() {
  const inputRef = useRef(null);
  const [clock, setClock] = useState(new Date());
  const [input, setInput] = useState("");
  const [pin, setPin] = useState("");
  const [validationError, setValidationError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState(null);
  const [modalError, setModalError] = useState("");
  const [modalType, setModalType] = useState("");
  const [autoCloseCountdown, setAutoCloseCountdown] = useState(5);
  const autoCloseTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getIstHourMinute = (dateObj) => {
    const istParts = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(dateObj);

    const hour = Number(istParts.find((p) => p.type === "hour")?.value || 0);
    const minute = Number(istParts.find((p) => p.type === "minute")?.value || 0);
    return { hour, minute };
  };

  const isClosedByIst = () => {
    const { hour, minute } = getIstHourMinute(clock);
    const totalMinutes = hour * 60 + minute;
    const openAt = 4 * 60; // 04:00 IST
    const closeAt = 22 * 60; // 22:00 IST
    return totalMinutes >= closeAt || totalMinutes < openAt;
  };

  const isClosed = isClosedByIst();

  const displayClock = isClosed
    ? "CLOSED"
    : clock.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

  useEffect(() => {
    return () => {
      clearTimeout(autoCloseTimerRef.current);
      clearInterval(countdownIntervalRef.current);
    };
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setModalData(null);
    setModalError("");
    setModalType("");
    setAutoCloseCountdown(5);
    clearTimeout(autoCloseTimerRef.current);
    clearInterval(countdownIntervalRef.current);
  }, []);

  const startAutoClose = useCallback(() => {
    clearTimeout(autoCloseTimerRef.current);
    clearInterval(countdownIntervalRef.current);
    setAutoCloseCountdown(5);
    countdownIntervalRef.current = setInterval(() => {
      setAutoCloseCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    autoCloseTimerRef.current = setTimeout(() => closeModal(), 5000);
  }, [closeModal]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isClosed) {
      setValidationError("Kiosk is closed. Opens at 04:00 AM IST.");
      return;
    }
    const now = Date.now();
    if (loading || now < cooldownUntil) return;

    const { valid, error } = validateInput(input);
    if (!valid) {
      setValidationError(error);
      return;
    }

    if (KIOSK_PIN_ENABLED && pin !== KIOSK_PIN) {
      setValidationError("Invalid kiosk PIN");
      return;
    }

    setLoading(true);
    setValidationError("");

    try {
      const response = await apiClient.post(
        "/attendance/search-punch",
        { input: sanitizeInput(input) },
        { headers: { "x-attendance-source": "kiosk" } }
      );
      const data = response.data;

      if (data.success) {
        if (data.isLate) setModalType("late");
        else if (data.isCheckOut) setModalType("checkout");
        else setModalType("checkin");
        setModalData(data);
        setModalError("");
        setShowModal(true);
        startAutoClose();
        setInput("");
      }
    } catch (err) {
      const errData = err.response?.data;
      if (errData?.gymClosed) {
        setModalType("closed");
        setModalData(errData);
        setModalError("");
      } else {
        setModalType("error");
        setModalData(null);
        setModalError(errData?.message || "Something went wrong");
      }
      setShowModal(true);
      startAutoClose();
    } finally {
      setLoading(false);
      setCooldownUntil(Date.now() + COOLDOWN_MS);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="homepage-shell auth-shell kiosk-shell">
      <div className="auth-panel kiosk-card">
        <p className="kiosk-eyebrow">Premium Fitness Club</p>
        <h1>GIRI GYM</h1>
        <p className="kiosk-clock">{displayClock}</p>
        <form onSubmit={handleSubmit} className="kiosk-form">
          {KIOSK_PIN_ENABLED ? (
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="Admin PIN"
              className="kiosk-input"
              maxLength={6}
              autoComplete="off"
            />
          ) : null}
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={input}
            onChange={(e) => {
              setInput(e.target.value.replace(/\D/g, ""));
              setValidationError("");
            }}
            placeholder="Gym ID or Phone"
            className="kiosk-input"
            autoComplete="off"
            id="kiosk-search-input"
            aria-label="Gym ID or Phone"
          />
          {validationError ? <p className="kiosk-error">{validationError}</p> : null}
          <button type="submit" className="btn btn-primary kiosk-punch" id="kiosk-search-btn" disabled={loading || isClosed}>
            {loading ? "Processing..." : "Punch"}
          </button>
          {isClosed ? <p className="kiosk-error">Kiosk opens daily at 04:00 AM IST.</p> : null}
        </form>
      </div>

      <PunchModal
        showModal={showModal}
        modalData={modalData}
        modalType={modalType}
        modalError={modalError}
        autoCloseCountdown={autoCloseCountdown}
        onClose={closeModal}
      />
    </div>
  );
}
