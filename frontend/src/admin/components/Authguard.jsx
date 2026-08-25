import { cloneElement } from "react";
import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import apiClient from "../../utils/apiClient.js";
import { AdminContext } from "../authContext.js";
import { getSessionIdentity, clearSessionIdentity } from "../../utils/sessionIdentity.js";

// AuthGuard is the single authenticated-admin source for the admin layout.
// It fetches GET /admin/me once on mount, provides the admin session through
// context (used by RoleGuard / sidebar / header) and passes it down through
// AdminLayout so the header can render the real session identity.
//
// Production-grade identity guard: if the resolved admin differs from the
// expected identity stored on THIS tab, the session was replaced by another
// login in the same browser (e.g. a duplicated tab with a stale sid). Rather
// than silently rendering another workspace, the tab redirects to login.
export default function AuthGuard({ children }) {
  const [auth, setAuth] = useState(null); // null = checking, object = admin, false = unauthenticated

  useEffect(() => {
    apiClient.get("/admin/me")
      .then((res) => {
        const me = res.data?.admin || res.data?.data || res.data || null;
        const serverSid = res.data?.sessionId || null;
        const expected = getSessionIdentity();

        // Guard: if this tab recorded an expected admin id and the server
        // authenticated a different one, the session was externally replaced.
        // Clear markers and redirect to login — never silently render another
        // workspace.
        const serverAdminId = me?._id || null;
        if (expected.adminId && serverAdminId && expected.adminId !== serverAdminId) {
          clearSessionIdentity();
          setAuth(false);
          return;
        }

        // If the session rotated / the sid changed, adopt the latest.
        if (expected.sessionId && serverSid && expected.sessionId !== serverSid) {
          clearSessionIdentity();
          setAuth(false);
          return;
        }

        setAuth(me || true);
      })
      .catch(() => {
        // Session revoked/expired — clear this tab's session markers.
        clearSessionIdentity();
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