import { cloneElement } from "react";
import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import apiClient from "../../utils/apiClient.js";
import { AdminContext } from "../authContext.js";

// AuthGuard is the single authenticated-admin source for the admin layout.
// It fetches GET /admin/me once on mount, provides the admin session through
// context (used by RoleGuard / sidebar / header) and passes it down through
// AdminLayout so the header can render the real session identity.
export default function AuthGuard({ children }) {
  const [auth, setAuth] = useState(null); // null = checking, object = admin, false = unauthenticated

  useEffect(() => {
    apiClient.get("/admin/me")
      .then((res) => {
        const me = res.data?.admin || res.data?.data || res.data || null;
        // Session-scoped identity: keep the per-tab session id so the server
        // resolves THIS tab's cookie pair, never another tab's.
        if (!sessionStorage.getItem("gym_session_id") && res.data?.sessionId) {
          sessionStorage.setItem("gym_session_id", res.data.sessionId);
        }
        setAuth(me || true);
      })
      .catch(() => {
        // Session revoked/expired — clear this tab's session marker.
        sessionStorage.removeItem("gym_session_id");
        setAuth(false);
      });
  }, []);

  if (auth === null) return <p>Checking...</p>;
  if (auth === false) return <Navigate to="/login" />;

  const admin = auth === true ? null : auth;
  return (
    <AdminContext.Provider value={admin}>
      {cloneElement(children, { admin })}
    </AdminContext.Provider>
  );
}
