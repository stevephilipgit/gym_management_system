import axios from "axios";

const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
export const API_BASE_URL = apiBaseUrl;

const apiClient = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("accessToken");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || "";
    const onProtectedPage = window.location.pathname.startsWith("/admin");
    const authCheckRequest = requestUrl.includes("/admin/me");

    if (error.response?.status === 401 && window.location.pathname !== "/login" && (onProtectedPage || authCheckRequest)) {
      localStorage.removeItem("accessToken");
      window.location.href = "/login";
    }

    if (error.response?.status === 429) {
      console.warn("[API] Rate limited. Retry after:", error.response.headers["retry-after"]);
    }

    return Promise.reject(error);
  }
);

export default apiClient;
