import { useNavigate } from "react-router-dom";
import { FiMenu } from "react-icons/fi";
import { useState } from "react";
import { getStoredTheme, toggleTheme } from "../theme.js";
import apiClient from "../utils/apiClient.js";

export default function AdminHeader({ toggleSidebar }) {
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, setTheme] = useState(getStoredTheme());

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await apiClient.post("/admin/logout", {});
      navigate("/login");
    } catch (err) {
      console.error("Logout error:", err);
      navigate("/login");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className="glass-bar">
      <div className="page-frame flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <button className="btn-ghost md:hidden" onClick={toggleSidebar} aria-label="Toggle sidebar">
            <FiMenu />
          </button>

          <div>
            <p className="eyebrow">Control Layer</p>
            <h1 className="text-xl font-extrabold sm:text-2xl">Giri Gym Admin Panel</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(toggleTheme())}
            aria-label="Toggle theme"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span className="text-sm font-semibold">{theme === "dark" ? "Night" : "Light"}</span>
            <span className="theme-toggle-track">
              <span className="theme-toggle-thumb" />
            </span>
          </button>

          <button onClick={handleLogout} disabled={loggingOut} className="btn-danger" aria-label="Logout">
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      </div>
    </header>
  );
}
