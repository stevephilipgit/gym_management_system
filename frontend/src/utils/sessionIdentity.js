// utils/sessionIdentity.js - Per-tab session identity markers
//
// Each tab pins its session with an opaque sid held in sessionStorage (NOT the
// JWT — the JWT stays in an HttpOnly cookie). We ALSO record the admin id that
// was used to log in on THIS tab so the frontend can detect when a tab is
// silently showing another session's workspace (e.g. a duplicated tab that
// inherited a stale sid, or a shared-browser login that replaced the cookie).
//
// Contract:
//   - saveSessionIdentity(sessionId, adminId): called ONLY by the login flow.
//   - getSessionIdentity(): read the expected identity of this tab.
//   - clearSessionIdentity(): called on logout, 401 redirect and contamination.
//
// sessionStorage is per-tab, so these markers are never shared across tabs.

const SID_KEY = "gym_session_id";
const ADMIN_ID_KEY = "gym_session_admin_id";

export const saveSessionIdentity = (sessionId, adminId) => {
  if (sessionId) sessionStorage.setItem(SID_KEY, String(sessionId));
  if (adminId) sessionStorage.setItem(ADMIN_ID_KEY, String(adminId));
};

export const getSessionIdentity = () => ({
  sessionId: sessionStorage.getItem(SID_KEY) || null,
  adminId: sessionStorage.getItem(ADMIN_ID_KEY) || null,
});

export const getSessionId = () => sessionStorage.getItem(SID_KEY) || null;

export const clearSessionIdentity = () => {
  sessionStorage.removeItem(SID_KEY);
  sessionStorage.removeItem(ADMIN_ID_KEY);
};
