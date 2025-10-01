import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import apiClient from "../../utils/apiClient.js";

export default function AuthGuard({ children }) {
  const [auth, setAuth] = useState(null);

  useEffect(() => {
    apiClient.get("/admin/me")
      .then(() => setAuth(true))
      .catch(() => setAuth(false));
  }, []);

  if (auth === null) return <p>Checking...</p>;
  return auth ? children : <Navigate to="/login" />;
}
