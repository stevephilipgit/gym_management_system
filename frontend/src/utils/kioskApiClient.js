// utils/kioskApiClient.js - Kiosk-specific API client
//
// This is a SEPARATE axios instance from the admin apiClient. It:
//   - attaches X-Kiosk-Id / X-Kiosk-Key headers from the kiosk device identity
//     (stored in localStorage, survives page refresh)
//   - does NOT attach X-Session-Id (that is for the admin auth system)
//   - does NOT redirect to /login on 401 (kiosk auth failures are shown as
//     kiosk-specific errors, never as admin session expiry)
//
// The admin apiClient's 401→login redirect is preserved for admin routes.

import axios from "axios";
import { getKioskId, getKioskKey } from "./kioskIdentity.js";

const apiBaseUrl = import.meta.env.VITE_API_URL || "/api";

const kioskApiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach kiosk identity headers from localStorage (persists across refresh).
kioskApiClient.interceptors.request.use(
  (config) => {
    const kioskId = getKioskId();
    const kioskKey = getKioskKey();
    if (kioskId) config.headers["X-Kiosk-Id"] = kioskId;
    if (kioskKey) config.headers["X-Kiosk-Key"] = kioskKey;
    return config;
  },
  (error) => Promise.reject(error)
);

// NO response interceptor that redirects to /login.
// Kiosk auth failures (401 / 403) are handled by the calling component as
// kiosk-specific errors — never as an admin session redirect.

export default kioskApiClient;