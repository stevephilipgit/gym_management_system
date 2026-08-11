import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../../utils/apiClient.js";
import { getDaysIndicatorClass } from "../../utils/memberStatus.js";

const AUTO_CLOSE_MS = 5000;

/** Parse dd/MM/yyyy (en-GB locale) into a JS Date */
function parseEnGBDate(str) {
  if (!str || str === "-") return null;
  // Already ISO format yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return new Date(str);
  // en-GB format: dd/MM/yyyy
  const [day, month, year] = str.split("/");
  if (!day || !month || !year) return null;
  return new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00`);
}

/** Calculate days remaining from any date string */
function calcDaysLeft(dateStr) {
  const date = parseEnGBDate(dateStr);
  if (!date || isNaN(date.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export const MembershipCheckSection = () => {
  const [searchType, setSearchType] = useState("phone");
  const [phone, setPhone] = useState("");
  const [gymId, setGymId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const [progress, setProgress] = useState(100);
  const timerRef = useRef(null);
  const progressRef = useRef(null);

  const closePopup = useCallback(() => {
    setShowPopup(false);
    clearTimeout(timerRef.current);
    clearInterval(progressRef.current);
    setProgress(100);
  }, []);

  const openPopup = useCallback(() => {
    setShowPopup(true);
    setProgress(100);
    clearTimeout(timerRef.current);
    clearInterval(progressRef.current);

    const startTime = Date.now();
    progressRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / AUTO_CLOSE_MS) * 100);
      setProgress(remaining);
      if (remaining <= 0) clearInterval(progressRef.current);
    }, 50);

    timerRef.current = setTimeout(() => {
      setShowPopup(false);
      setProgress(100);
    }, AUTO_CLOSE_MS);
  }, []);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    clearInterval(progressRef.current);
  }, []);

  const checkMembership = async () => {
    setError("");
    setResult(null);

    if (searchType === "phone") {
      const cleanPhone = phone.replace(/\D/g, "");
      if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
        setError("Enter a valid 10-digit phone number");
        openPopup();
        return;
      }
    } else if (!gymId.trim()) {
      setError("Enter a Gym ID");
      openPopup();
      return;
    }

    setLoading(true);
    try {
      const url =
        searchType === "phone"
          ? `${API_BASE_URL}/public/check-member?phone=${phone.replace(/\D/g, "")}`
          : `${API_BASE_URL}/public/check-member?gymId=${gymId}`;

      const res = await fetch(url);
      const data = await res.json();
      const payload = data?.data || data;

      if (!res.ok) {
        setError(payload?.message || "Failed to check membership");
        openPopup();
        return;
      }

      if (!payload?.found) {
        setError(payload?.message || "No membership found");
        openPopup();
        return;
      }

      // Fix: prefer backend's daysLeft; recalculate from validityEndDate as fallback
      // Backend sends validityEndDate as dd/MM/yyyy (en-GB locale)
      const daysLeft =
        typeof payload.daysLeft === "number"
          ? payload.daysLeft
          : calcDaysLeft(payload.validityEndDate);

      setResult({ ...payload, daysLeft });
      openPopup();
    } catch (err) {
      setError("Failed to check membership");
      console.error(err);
      openPopup();
    } finally {
      setLoading(false);
    }
  };

  const daysLeft = result?.daysLeft ?? 0;
  const isExpiring = result?.found && daysLeft <= 3;

  return (
    <>
      {/* ── Navbar search bar ─────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex gap-3">
          {["phone", "gymId"].map((type) => (
            <label key={type} className="radio-row text-sm">
              <input
                type="radio"
                value={type}
                checked={searchType === type}
                onChange={(e) => {
                  setSearchType(e.target.value);
                  setError("");
                  setResult(null);
                }}
                className="accent-check"
              />
              {type === "phone" ? "Phone" : "Gym ID"}
            </label>
          ))}
        </div>

        <input
          type={searchType === "phone" ? "tel" : "text"}
          className="field-control w-full sm:w-44"
          placeholder={searchType === "phone" ? "Enter phone" : "Enter Gym ID"}
          value={searchType === "phone" ? phone : gymId}
          onChange={(e) =>
            searchType === "phone" ? setPhone(e.target.value) : setGymId(e.target.value)
          }
          onKeyDown={(e) => e.key === "Enter" && checkMembership()}
        />

        <button
          onClick={checkMembership}
          disabled={loading}
          className="btn-primary whitespace-nowrap"
          style={{ minHeight: "40px", padding: "8px 16px" }}
        >
          {loading ? "Checking..." : "Check"}
        </button>
      </div>

      {/* ── Centered fullscreen popup ─────────────────────── */}
      {showPopup && (
        <div
          className="membership-popup-overlay"
          onClick={closePopup}
          role="dialog"
          aria-modal="true"
          aria-label="Membership status"
        >
          <div
            className="membership-popup-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Progress countdown bar */}
            <div className="membership-popup-progress-track">
              <div
                className="membership-popup-progress-bar"
                style={{ width: `${progress}%` }}
              />
            </div>

            {error ? (
              <div className="membership-popup-body">
                <div className="membership-popup-icon membership-popup-icon-error">✕</div>
                <p className="panel-title" style={{ textAlign: "center" }}>Not Found</p>
                <p className="muted-copy" style={{ textAlign: "center" }}>{error}</p>
              </div>
            ) : result?.found ? (
              <div className="membership-popup-body">
                {/* Status badge */}
                <div style={{ textAlign: "center" }}>
                  <div
                    className={`membership-popup-icon ${
                      isExpiring ? "membership-popup-icon-warn" : "membership-popup-icon-ok"
                    }`}
                  >
                    {isExpiring ? "⚠" : "✓"}
                  </div>
                  <div
                    className={`status-pill mt-3 ${getDaysIndicatorClass(daysLeft)}`}
                    style={{ display: "inline-block" }}
                  >
                    {result.status?.toUpperCase()}
                  </div>
                </div>

                <div className="membership-popup-details">
                  <DetailRow label="Name" value={result.name} />
                  <DetailRow label="Gym ID" value={result.gymId} />
                  <DetailRow label="Plan" value={result.plan} />
                  <DetailRow label="Valid Till" value={result.validityEndDate} />
                  <DetailRow
                    label="Days Remaining"
                    value={daysLeft}
                    highlight={isExpiring}
                  />
                </div>
              </div>
            ) : null}

            <button className="btn-ghost mt-4 w-full" onClick={closePopup}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};

function DetailRow({ label, value, highlight = false }) {
  return (
    <div className="membership-detail-row">
      <span className="muted-copy" style={{ fontSize: "0.8rem" }}>{label}</span>
      <span
        className={`font-semibold ${highlight ? "text-danger" : ""}`}
        style={{ fontSize: "1rem", color: highlight ? "var(--danger)" : "var(--text-primary)" }}
      >
        {value}
      </span>
    </div>
  );
}
