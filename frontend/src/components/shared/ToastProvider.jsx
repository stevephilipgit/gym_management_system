/**
 * ToastProvider.jsx — Global toast notification system (Giri Gym Admin Panel).
 *
 * Single <ToastProvider /> mounted at the app root (App.jsx). Any component
 * under it can fire notifications:
 *
 *   const toast = useToast();
 *   toast.success("Found 20 inactive members");
 *   toast.error("Failed to load inactive members");
 *   toast.warning("Please select both dates");
 *   toast.info("Sync started");
 *
 * Rendering:
 * - The viewport is portaled to document.body and position:fixed top-right,
 *   so toasts never affect page layout and sit above modals/dropdowns
 *   (z-index 10000 — modals/overlays in this app use 9999 and below).
 *
 * Lifecycle per toast:
 *   enter animation (~250ms) -> visible hold (3000ms) ->
 *   exit animation (~250ms fade + slide right + height collapse) -> removed.
 * The 3s hold starts after the enter animation finishes. Exit removal is
 * timer-driven (not animationend) so it also works when animations are
 * disabled via prefers-reduced-motion.
 *
 * Hygiene:
 * - Every timer is tracked per toast id and cleared on dismiss and on
 *   provider unmount — no stale timers or memory leaks.
 * - Identical (type + message) calls within 400ms are ignored to guard
 *   against duplicate toasts from double-fired callbacks/re-renders.
 * - Hard cap of 5 simultaneous toasts prevents viewport flooding.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  FiAlertCircle,
  FiAlertTriangle,
  FiCheckCircle,
  FiInfo,
  FiX,
} from "react-icons/fi";

const ToastContext = createContext(null);

/**
 * Access the global toast API. Must be used inside <ToastProvider />.
 * Returns a stable object: { success, error, warning, info, dismiss }.
 */
// The provider and its hook intentionally share one context module.
// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return ctx;
};

// ── Timing constants (must stay in sync with the CSS animation durations) ──
const HOLD_MS = 3000;   // visible hold time before the exit animation starts
const ENTER_MS = 250;   // entrance animation duration
const EXIT_MS = 250;    // exit animation duration
const MAX_TOASTS = 5;   // hard cap on simultaneous toasts
const DEDUPE_MS = 400;  // identical type+message within this window is ignored

const TYPE_DEFS = {
  success: { icon: FiCheckCircle, assertive: false },
  error: { icon: FiAlertCircle, assertive: true },
  warning: { icon: FiAlertTriangle, assertive: true },
  info: { icon: FiInfo, assertive: false },
};

// Module-level monotonic id counter — stable across StrictMode remounts.
let nextToastId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // toastId -> { hold: timeoutId|null, exit: timeoutId|null }
  const timersRef = useRef(new Map());
  // "type|message" -> timestamp of last emit (duplicate suppression)
  const recentRef = useRef(new Map());

  const clearToastTimers = useCallback((id) => {
    const timers = timersRef.current.get(id);
    if (!timers) return;
    if (timers.hold) clearTimeout(timers.hold);
    if (timers.exit) clearTimeout(timers.exit);
    timersRef.current.delete(id);
  }, []);

  const clearAllTimers = useCallback(() => {
    for (const id of Array.from(timersRef.current.keys())) {
      clearToastTimers(id);
    }
  }, [clearToastTimers]);

  // Cleanup every pending timer when the provider unmounts — navigation can
  // never leave stale timers behind.
  useEffect(() => clearAllTimers, [clearAllTimers]);

  /** Start the smooth exit animation; the toast is removed shortly after. */
  const dismiss = useCallback(
    (id) => {
      const timers = timersRef.current.get(id);
      if (!timers || timers.exit) return; // unknown id or already exiting
      if (timers.hold) {
        clearTimeout(timers.hold);
        timers.hold = null;
      }
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, leaving: true } : t))
      );
      // Timer-driven removal: deterministic even if animations never fire.
      timers.exit = setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, EXIT_MS + 60);
    },
    []
  );

  const push = useCallback(
    (type, message, options = {}) => {
      if (!message) return null;

      // Duplicate guard: same type+message fired again within DEDUPE_MS is
      // suppressed (protects against double-invoked callbacks/re-renders).
      const dedupeKey = `${type}|${message}`;
      const now = Date.now();
      const lastAt = recentRef.current.get(dedupeKey);
      if (lastAt && now - lastAt < DEDUPE_MS) return null;
      recentRef.current.set(dedupeKey, now);
      if (recentRef.current.size > 50) {
        for (const [k, t] of recentRef.current) {
          if (now - t > DEDUPE_MS) recentRef.current.delete(k);
        }
      }

      const id = nextToastId++;
      const timers = { hold: null, exit: null };
      timersRef.current.set(id, timers);

      // 3s hold starts once the entrance animation has completed.
      const holdMs =
        typeof options.duration === "number" ? options.duration : HOLD_MS;
      timers.hold = setTimeout(() => dismiss(id), ENTER_MS + holdMs);

      setToasts((prev) => {
        const next = [...prev, { id, type, message, leaving: false }];
        if (next.length > MAX_TOASTS) {
          // Overflow: drop the oldest toasts immediately and clear their
          // timers so nothing is left pending.
          for (const dropped of next.slice(0, next.length - MAX_TOASTS)) {
            clearToastTimers(dropped.id);
          }
          return next.slice(next.length - MAX_TOASTS);
        }
        return next;
      });
      return id;
    },
    [dismiss, clearToastTimers]
  );

  const toastApi = useMemo(
    () => ({
      success: (message, options) => push("success", message, options),
      error: (message, options) => push("error", message, options),
      warning: (message, options) => push("warning", message, options),
      info: (message, options) => push("info", message, options),
      dismiss: (id) => dismiss(id),
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={toastApi}>
      {children}
      {createPortal(
        <div className="toast-viewport" role="region" aria-label="Notifications">
          <ol className="toast-stack">
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </ol>
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }) {
  const def = TYPE_DEFS[toast.type] || TYPE_DEFS.info;
  const Icon = def.icon;
  return (
    <li
      className={`toast-item ${toast.leaving ? "toast-leaving" : "toast-entering"}`}
    >
      <div
        className={`toast-card toast-${toast.type}`}
        role={def.assertive ? "alert" : "status"}
        aria-atomic="true"
      >
        <span className="toast-icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <span className="toast-message">{toast.message}</span>
        <button
          type="button"
          className="toast-close"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          title="Dismiss"
        >
          <FiX size={14} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}