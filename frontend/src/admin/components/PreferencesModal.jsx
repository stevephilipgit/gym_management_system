import { useEffect, useState } from "react";
import apiClient from "../../utils/apiClient.js";
import {
  applyDensity,
  DENSITY_LEVELS,
  DENSITY_LABELS,
  DENSITY_HINTS,
  normalizeDensity,
} from "../../theme.js";

const TINY = DENSITY_LEVELS.TINY;
const MINI = DENSITY_LEVELS.MINI;
const COMPACT = DENSITY_LEVELS.COMPACT;
const MEDIUM = DENSITY_LEVELS.MEDIUM;
const SPACIOUS = DENSITY_LEVELS.SPACIOUS;

export default function PreferencesModal({ open, onClose, admin }) {
  const adminId = admin?._id || null;

  // Read the actual applied density from the DOM as the single source of
  // truth. AuthGuard already resolved server prefs vs localStorage and wrote
  // data-density. This avoids the stale-prop / default-Medium bug.
  const getCurrentDensity = () => {
    if (typeof document === "undefined") return DENSITY_LEVELS.MEDIUM;
    const raw = document.documentElement.getAttribute("data-density");
    return normalizeDensity(raw !== null ? raw : DENSITY_LEVELS.MEDIUM);
  };

  // Initial density from the DOM on each mount. The modal is conditionally
  // rendered (if (!open) return null), so each open is a fresh mount and
  // this initial value always reflects the currently applied density.
  const [editedValue, setEditedValue] = useState(() => getCurrentDensity());

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const value = editedValue;

  const handleChange = (event) => {
    const next = normalizeDensity(event.target.value);
    setEditedValue(next);
    applyDensity(next, adminId);

    if (adminId) {
      apiClient
        .put("/admin/preferences", { uiDensity: next })
        .catch(() => {
          // Non-fatal: the in-memory density and localStorage are already
          // updated; a failed PUT just means the server syncs on next change.
        });
    }
  };

  const label = DENSITY_LABELS[value] || "Medium";
  const hint = DENSITY_HINTS[value] || "";

  const levels = [TINY, MINI, COMPACT, MEDIUM, SPACIOUS];
  const labels = DENSITY_LABELS;

  return (
    <div
      className="modal-shell"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prefs-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="modal-card prefs-modal-card">
        <div className="modal-header">
          <div>
            <h2 id="prefs-modal-title" className="prefs-modal-title">
              Preferences
            </h2>
            <p className="prefs-modal-subtitle">UI Density</p>
          </div>
          <button
            type="button"
            className="icon-close-btn"
            aria-label="Close preferences"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="modal-content">
          <div className="prefs-slider-wrap">
            <div className="density-slider">
              <input
                type="range"
                min="0"
                max="4"
                step="1"
                value={value}
                onChange={handleChange}
                aria-label="UI Density"
                aria-valuetext={label}
                className="prefs-density-slider"
              />
              <div className="density-slider-markers" aria-hidden="true">
                {levels.map((lvl) => (
                  <span
                    key={lvl}
                    className={`density-marker${value === lvl ? " is-active" : ""}`}
                  />
                ))}
              </div>
            </div>

            <div className="prefs-slider-labels" aria-hidden="true">
              {labels.map((lbl, i) => (
                <span
                  key={i}
                  className={`prefs-slider-tick${value === i ? " is-active" : ""}`}
                >
                  {lbl}
                </span>
              ))}
            </div>

            <p className="prefs-slider-hint" aria-live="polite">
              {hint}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}