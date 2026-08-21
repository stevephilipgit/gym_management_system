import axios from "axios";

const apiBaseUrl = import.meta.env.VITE_API_URL || "/api";
export const API_BASE_URL = apiBaseUrl;

const apiClient = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Skip automatic auth handling for endpoints that manage authentication themselves.
const isAuthRoute = (url = "") =>
  url.includes("/admin/login") ||
  url.includes("/admin/captcha") ||
  url.includes("/admin/refresh") ||
  url.includes("/admin/forgot") ||
  url.includes("/admin/reset");

// Single-flight refresh so concurrent 401s trigger one refresh call.
let isRefreshing = false;
let refreshQueue = [];

const refreshSession = async () => {
  const sid = sessionStorage.getItem("gym_session_id");
  const headers = sid ? { "X-Session-Id": sid } : {};
  const response = await axios.post(`${apiBaseUrl}/admin/refresh`, {}, { withCredentials: true, headers });
  return response.data;
};

const redirectToLogin = () => {
  sessionStorage.removeItem("gym_session_id");
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
};

const flushRefreshQueue = () => {
  const queue = refreshQueue;
  refreshQueue = [];
  queue.forEach(({ config, resolve, reject }) => {
    apiClient(config).then(resolve).catch(reject);
  });
};

const rejectRefreshQueue = () => {
  const queue = refreshQueue;
  refreshQueue = [];
  queue.forEach(({ reject }) => reject(new Error("Session expired")));
};

// Attach the per-tab session identifier so the server can pick the correct
// httpOnly cookie pair. This is NOT a JWT — it is an opaque session id held
// only in sessionStorage (per-tab, cleared on close).
apiClient.interceptors.request.use(
  (config) => {
    const sid = sessionStorage.getItem("gym_session_id");
    if (sid) {
      config.headers["X-Session-Id"] = sid;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || "";

    // 429: rate limited — keep going, caller may retry.
    if (error.response?.status === 429) {
      console.warn("[API] Rate limited. Retry after:", error.response.headers["retry-after"]);
      return Promise.reject(error);
    }

    if (error.response?.status !== 401) {
      return Promise.reject(error);
    }

    if (window.location.pathname === "/login" || isAuthRoute(requestUrl)) {
      return Promise.reject(error);
    }

    const originalRequest = error.config;

    // If a refresh is already in flight, queue this request and retry after it completes.
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push({ config: originalRequest, resolve, reject });
      });
    }

    // Mark as retried to prevent infinite retry loops.
    if (originalRequest._retry) {
      redirectToLogin();
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    isRefreshing = true;

    return refreshSession()
      .then(() => {
        isRefreshing = false;
        flushRefreshQueue();
        return apiClient(originalRequest);
      })
      .catch((refreshError) => {
        isRefreshing = false;
        rejectRefreshQueue();
        redirectToLogin();
        return Promise.reject(refreshError);
      });
  }
);

export default apiClient;