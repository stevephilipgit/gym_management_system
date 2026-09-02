import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import apiClient from "../utils/apiClient.js";
import kioskApiClient from "../utils/kioskApiClient.js";
import PunchModal from "../components/shared/PunchModal.jsx";
import { isKioskConfigured } from "../utils/kioskIdentity.js";
import { getSessionId } from "../utils/sessionIdentity.js";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

const COOLDOWN_MS = 2500;
const INACTIVITY_RESET_MS = 30000;

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

function kioskErrorInfo(err) {
  const data = err?.response?.data;
  const status = err?.response?.status;
  if (data?.gymClosed || data?.status === "gym_closed") return { type: "closed", data };
  if (status === 401 || status === 403) {
    return {
      type: "error",
      data: null,
      message: data?.message || "Kiosk is not authorized. Please contact the gym staff.",
    };
  }
  return {
    type: "error",
    data: null,
    message: data?.message || "Something went wrong. Please try again.",
  };
}

export default function KioskAttendance() {
  const inputRef = useRef(null);
  const [clock, setClock] = useState(new Date());
  const [input, setInput] = useState("");
  const [validationError, setValidationError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  // Disambiguation candidates
  const [candidates, setCandidates] = useState([]);
  const [pickerError, setPickerError] = useState("");

  // Result modal
  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState(null);
  const [modalError, setModalError] = useState("");
  const [modalType, setModalType] = useState("");
  const [autoCloseCountdown, setAutoCloseCountdown] = useState(5);
  const autoCloseTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const inactivityTimerRef = useRef(null);
  const interactionIdRef = useRef(0);

  // ── Super Admin attendance mode ──────────────────────────────────────
  // The server admin session takes precedence over stale kiosk credentials.
  const [admin, setAdmin] = useState(null); // { role, id } or null
  const [adminChecking, setAdminChecking] = useState(true);
  // Scope selection state
  const [scopes, setScopes] = useState(null); // null = not selected, { token, scope, expiresAt }
  const [scopeSelecting, setScopeSelecting] = useState(false);

  // Kiosk device readiness (used only when NOT a Super Admin)
  const kioskConfigured = isKioskConfigured();

  // Detect admin session at mount. Uses a BARE axios call (not apiClient) so a
  // non-admin visitor (customer) is never redirected to /login by the apiClient
  // 401 interceptor — this page must stay a neutral kiosk surface.
  useEffect(() => {
    const sid = getSessionId();
    axios
      .get(`${API_BASE_URL}/admin/me`, {
        withCredentials: true,
        headers: sid ? { "X-Session-Id": sid } : {},
        timeout: 8000,
      })
      .then((res) => {
        const me = res.data?.admin || res.data?.data || res.data || null;
        setAdmin(me);
      })
      .catch(() => {
        setAdmin(null);
      })
      .finally(() => setAdminChecking(false));
  }, []);

  // ── Neutral state reset ──────────────────────────────────────────────
  const resetToNeutral = useCallback(() => {
    setInput("");
    setValidationError("");
    setCandidates([]);
    setPickerError("");
    setShowModal(false);
    setModalData(null);
    setModalError("");
    setModalType("");
    setAutoCloseCountdown(5);
    clearTimeout(autoCloseTimerRef.current);
    clearInterval(countdownIntervalRef.current);
    interactionIdRef.current += 1;
  }, []);

  const scheduleInactivityReset = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      resetToNeutral();
      inputRef.current?.focus();
    }, INACTIVITY_RESET_MS);
  }, [resetToNeutral]);

  useEffect(() => {
    return () => {
      clearTimeout(autoCloseTimerRef.current);
      clearInterval(countdownIntervalRef.current);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, []);

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

  const isClosed = (() => {
    const { hour, minute } = getIstHourMinute(clock);
    const totalMinutes = hour * 60 + minute;
    return totalMinutes >= 22 * 60 || totalMinutes < 4 * 60;
  })();

  const displayClock = isClosed
    ? "CLOSED"
    : clock.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

  // ── Modal helpers ────────────────────────────────────────────────────
  const closeModal = useCallback(() => {
    setShowModal(false);
    setModalData(null);
    setModalError("");
    setModalType("");
    setAutoCloseCountdown(5);
    clearTimeout(autoCloseTimerRef.current);
    clearInterval(countdownIntervalRef.current);
    resetToNeutral();
    scheduleInactivityReset();
  }, [resetToNeutral, scheduleInactivityReset]);

  const startAutoClose = useCallback(() => {
    clearTimeout(autoCloseTimerRef.current);
    clearInterval(countdownIntervalRef.current);
    setAutoCloseCountdown(5);
    countdownIntervalRef.current = setInterval(() => {
      setAutoCloseCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    autoCloseTimerRef.current = setTimeout(() => closeModal(), 5000);
  }, [closeModal]);

  const showResultModal = useCallback(
    (data) => {
      let type = "checkin";
      if (data.isLate) type = "late";
      else if (data.isCheckOut) type = "checkout";
      setModalType(type);
      setModalData(data);
      setModalError("");
      setShowModal(true);
      startAutoClose();
    },
    [startAutoClose]
  );

  const showErrorModal = useCallback(
    (message, data) => {
      const { type, data: d, message: msg } =
        typeof message === "object"
          ? kioskErrorInfo(message)
          : { type: "error", data: data || null, message };
      setModalType(type);
      setModalData(d || null);
      setModalError(msg || "");
      setShowModal(true);
      startAutoClose();
    },
    [startAutoClose]
  );

  // ── Super Admin: scope selection ────────────────────────────────────
  const isSuperAdmin = admin?.role === "superadmin";

  const selectScope = async (scope) => {
    if (scopeSelecting) return;
    setScopeSelecting(true);
    try {
      const res = await apiClient.post("/attendance/admin-scope", { scope });
      const { token, scope: sc, expiresAt } = res.data || {};
      if (!token) {
        showErrorModal("Scope selection failed. Please try again.");
        return;
      }
      // Store the token in React state only — not in localStorage, URLs, or logs.
      setScopes({ token, scope: sc, expiresAt: expiresAt || new Date(Date.now() + 120000).toISOString() });
      setInput("");
      setValidationError("");
      inputRef.current?.focus();
    } catch (err) {
      showErrorModal(err?.response?.data?.message || "Scope selection failed. Please try again.");
    } finally {
      setScopeSelecting(false);
    }
  };

  const clearScope = () => {
    setScopes(null);
    setInput("");
    setValidationError("");
    setCandidates([]);
    setPickerError("");
  };

  // ── Punch request ───────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isClosed) {
      setValidationError("Gym is closed. Opens at 04:00 AM IST.");
      return;
    }
    const now = Date.now();
    if (loading || now < cooldownUntil) return;

    const { valid, error } = validateInput(input);
    if (!valid) {
      setValidationError(error);
      return;
    }

    setLoading(true);
    setValidationError("");
    const interactionId = ++interactionIdRef.current;

    try {
      if (isSuperAdmin && scopes) {
        // Super Admin punch via admin attendance token.
        const response = await apiClient.post("/attendance/kiosk/admin-punch", {
          input: sanitizeInput(input),
        }, {
          headers: { "X-Admin-Attendance-Token": scopes.token },
        });
        const data = response.data;
        if (interactionId !== interactionIdRef.current) return;

        if (data?.status === "ambiguous" && Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
          setPickerError("");
          setInput("");
          setValidationError("");
          scheduleInactivityReset();
        } else if (data?.status === "success" || data?.success) {
          showResultModal(data);
          setInput("");
          setValidationError("");
        } else {
          const { data: d, message } = kioskErrorInfo({ response: { data, status: data?.status } });
          showErrorModal(message, d);
          setInput("");
          setValidationError("");
        }
      } else {
        // Trainer device punch via kiosk credential.
        const response = await kioskApiClient.post("/attendance/kiosk/punch", {
          input: sanitizeInput(input),
        });
        const data = response.data;
        if (interactionId !== interactionIdRef.current) return;

        if (data?.status === "ambiguous" && Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
          setPickerError("");
          setInput("");
          setValidationError("");
          scheduleInactivityReset();
        } else if (data?.status === "success" || data?.success) {
          showResultModal(data);
          setInput("");
          setValidationError("");
        } else {
          const { data: d, message } = kioskErrorInfo({ response: { data, status: data?.status } });
          showErrorModal(message, d);
          setInput("");
          setValidationError("");
        }
      }
    } catch (err) {
      if (interactionId !== interactionIdRef.current) return;
      showErrorModal(err);
      setInput("");
      setValidationError("");
    } finally {
      setLoading(false);
      setCooldownUntil(Date.now() + COOLDOWN_MS);
      inputRef.current?.focus();
    }
  };

  // ── Candidate selection ─────────────────────────────────────────────
  const handleSelectCandidate = async (candidate) => {
    if (loading) return;
    setLoading(true);
    setPickerError("");
    const interactionId = ++interactionIdRef.current;

    try {
      const payload = candidate.selectionToken
        ? { selectionToken: candidate.selectionToken }
        : { memberCode: candidate.memberCode };

      let response;
      if (isSuperAdmin && scopes) {
        response = await apiClient.post("/attendance/kiosk/admin-punch", payload, {
          headers: { "X-Admin-Attendance-Token": scopes.token },
        });
      } else {
        response = await kioskApiClient.post("/attendance/kiosk/punch", payload);
      }
      const data = response.data;

      if (interactionId !== interactionIdRef.current) return;

      if (data?.status === "success" || data?.success) {
        setCandidates([]);
        showResultModal(data);
      } else {
        setCandidates([]);
        const { data: d, message } = kioskErrorInfo({ response: { data, status: data?.status } });
        showErrorModal(message, d);
      }
    } catch (err) {
      if (interactionId !== interactionIdRef.current) return;
      setCandidates([]);
      showErrorModal(err);
    } finally {
      setLoading(false);
      setCooldownUntil(Date.now() + COOLDOWN_MS);
    }
  };

  const handleCancelPicker = () => {
    setCandidates([]);
    setPickerError("");
    resetToNeutral();
    scheduleInactivityReset();
    inputRef.current?.focus();
  };

  const onInputChange = (e) => {
    setInput(e.target.value.replace(/\D/g, ""));
    setValidationError("");
    scheduleInactivityReset();
  };

  // ── Render: admin checking ──────────────────────────────────────────────────
  if (adminChecking) {
    return (
      <div className="homepage-shell auth-shell kiosk-shell">
        <div className="auth-panel kiosk-card">
          <p className="muted-copy">Loading...</p>
        </div>
      </div>
    );
  }

  // ── Render: Super Admin scope selection ─────────────────────────────────────
  const showScopeSelector = isSuperAdmin && !scopes;

  return (
    <div className="homepage-shell auth-shell kiosk-shell">
      <div className="auth-panel kiosk-card">
        <p className="kiosk-eyebrow">Premium Fitness Club</p>
        <h1>GIRI GYM</h1>
        <p className="kiosk-clock">{displayClock}</p>

        {showScopeSelector ? (
          <div className="kiosk-form">
            <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Select Attendance Scope</p>
            <p className="muted-copy" style={{ fontSize: 12, marginBottom: 14 }}>
              Choose the gender population you are attending to.
            </p>
            <button
              type="button"
              className="btn btn-primary kiosk-punch"
              style={{ marginBottom: 8 }}
              disabled={scopeSelecting}
              onClick={() => selectScope("male")}
            >
              {scopeSelecting ? "Selecting..." : "Male"}
            </button>
            <button
              type="button"
              className="btn btn-primary kiosk-punch"
              disabled={scopeSelecting}
              onClick={() => selectScope("female_plus_transgender")}
            >
              {scopeSelecting ? "Selecting..." : "Female + Transgender"}
            </button>
          </div>
        ) : isSuperAdmin && scopes ? (
          <>
            <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="admin-device-badge badge-active" style={{ fontSize: 11 }}>
                {scopes.scope === "male" ? "Male Scope" : "Female + Transgender Scope"}
              </span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={loading}
                onClick={clearScope}
                style={{ fontSize: 11, padding: "2px 8px" }}
              >
                Change Scope
              </button>
            </div>
            {candidates.length > 0 ? renderPicker() : renderForm()}
          </>
        ) : kioskConfigured ? (
          candidates.length > 0 ? renderPicker() : renderForm()
        ) : (
          <div className="kiosk-form">
            <p className="kiosk-error">Attendance kiosk is unavailable.</p>
            <p className="muted-copy" style={{ fontSize: 14, marginTop: 4 }}>
              Please contact gym staff.
            </p>
          </div>
        )}
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

  function renderForm() {
    return (
      <form onSubmit={handleSubmit} className="kiosk-form">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={input}
          onChange={onInputChange}
          placeholder="Gym ID or Phone"
          className="kiosk-input"
          autoComplete="off"
          id="kiosk-search-input"
          aria-label="Gym ID or Phone"
          autoFocus
        />
        {validationError ? <p className="kiosk-error">{validationError}</p> : null}
        <button
          type="submit"
          className="btn btn-primary kiosk-punch"
          id="kiosk-search-btn"
          disabled={loading || isClosed}
        >
          {loading ? "Processing..." : "Punch"}
        </button>
        {isClosed ? <p className="kiosk-error">Gym opens daily at 04:00 AM IST.</p> : null}
      </form>
    );
  }

  function renderPicker() {
    return (
      <div className="kiosk-form">
        <p className="kiosk-picker-title">Who are you?</p>
        <p className="muted-copy" style={{ marginBottom: "10px" }}>
          Multiple members share this ID. Choose your profile to continue.
        </p>
        <div className="kiosk-candidates">
          {candidates.map((c, idx) => (
            <button
              type="button"
              key={`${c.memberCode || c.gymId}-${idx}`}
              className="kiosk-candidate"
              disabled={loading}
              onClick={() => handleSelectCandidate(c)}
            >
              <span className="kiosk-candidate-name">{c.fullName}</span>
              <span className="kiosk-candidate-code">
                {c.memberCode ? `${c.memberCode} · ` : ""}
                {c.gender}
              </span>
            </button>
          ))}
        </div>
        {pickerError ? <p className="kiosk-error">{pickerError}</p> : null}
        <button
          type="button"
          className="btn btn-outline kiosk-cancel"
          disabled={loading}
          onClick={handleCancelPicker}
        >
          Cancel
        </button>
      </div>
    );
  }
}