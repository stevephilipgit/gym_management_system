import { cloneElement } from "react";
import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import apiClient from "../../utils/apiClient.js";
import { AdminContext } from "../authContext.js";
import { getSessionIdentity, clearSessionIdentity } from "../../utils/sessionIdentity.js";
import { applyDensity, DENSITY_LEVELS, DENSITY_SCHEMA_VERSION, getStoredDensity, migrateLegacyDensity, normalizeDensity } from "../../theme.js";

export default function AuthGuard({ children }) {
  const [auth, setAuth] = useState(null);

  useEffect(() => {
    apiClient.get("/admin/me")
      .then((res) => {
        const me = res.data?.admin || res.data?.data || res.data || null;
        const serverSid = res.data?.sessionId || null;
        const expected = getSessionIdentity();

        const serverAdminId = me?._id || null;
        if (expected.adminId && serverAdminId && expected.adminId !== serverAdminId) {
          clearSessionIdentity();
          setAuth(false);
          return;
        }

        if (expected.sessionId && serverSid && expected.sessionId !== serverSid) {
          clearSessionIdentity();
          setAuth(false);
          return;
        }

        if (serverAdminId) {
          const raw = me?.preferences?.uiDensity;
          if (raw !== undefined && raw !== null) {
            const numericRaw = Number(raw);
            if (Number.isFinite(numericRaw)) {
              const storedVersionRaw = (() => {
                try {
                  return window.localStorage.getItem(`giri-gym-ui-density-version:${serverAdminId}`);
                } catch { return null; }
              })();
              const storedVersion = Number(storedVersionRaw);

              if (Number.isFinite(storedVersion) && storedVersion >= DENSITY_SCHEMA_VERSION) {
                applyDensity(numericRaw, serverAdminId);
              } else if (numericRaw <= 2) {
                const migrated = migrateLegacyDensity(numericRaw);
                applyDensity(migrated !== null ? migrated : normalizeDensity(raw), serverAdminId);
              } else {
                applyDensity(numericRaw, serverAdminId);
              }
            } else {
              applyDensity(getStoredDensity(serverAdminId), serverAdminId);
            }
          } else {
            applyDensity(getStoredDensity(serverAdminId), serverAdminId);
          }
        }

        setAuth(me || true);
      })
      .catch(() => {
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