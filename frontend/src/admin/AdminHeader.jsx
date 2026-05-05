import { useLocation } from "react-router-dom";
import { FiMenu, FiBell } from "react-icons/fi";
import { useState } from "react";
import { getStoredTheme, toggleTheme } from "../theme.js";

const PAGE_TITLES = {
  "/admin":                        "Dashboard",
  "/admin/register":               "Register Member",
  "/admin/due":                    "View Dues",
  "/admin/members":                "All Members",
  "/admin/update":                 "Update Member",
  "/admin/packages":               "Manage Packages",
  "/admin/diet-manager":           "Diet Manager",
  "/admin/ai-assistant":           "AI Assistant",
  "/admin/fields":                 "Edit Form Fields",
  "/admin/attendance-front-desk":  "Attendance",
  "/admin/corrections":            "Corrections",
  "/admin/inactivity-reports":     "Inactivity Reports",
  "/admin/enquiries":              "Enquiries",
  "/admin/settings":               "Settings",
};

export default function AdminHeader({ toggleSidebar }) {
  const location  = useLocation();
  const [theme, setTheme] = useState(getStoredTheme());

  const pageTitle = PAGE_TITLES[location.pathname] ?? "Admin Panel";

  return (
    <header className="admin-topbar">
      <div className="admin-topbar-inner">

        {/* ── Left: mobile toggle + page title ─────── */}
        <div className="admin-topbar-left">
          <button
            className="btn-ghost md:hidden"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <FiMenu />
          </button>

          <div className="admin-page-title-wrap">
            <p className="admin-breadcrumb">Giri Gym</p>
            <h1 className="admin-page-title">{pageTitle}</h1>
          </div>
        </div>

        {/* ── Right: controls ───────────────────────── */}
        <div className="admin-topbar-right">

          {/* Theme toggle */}
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(toggleTheme())}
            aria-label="Toggle theme"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span className="text-sm font-semibold">
              {theme === "dark" ? "Night" : "Light"}
            </span>
            <span className="theme-toggle-track">
              <span className="theme-toggle-thumb" />
            </span>
          </button>

          {/* Notification bell */}
          <button className="admin-notif-btn" aria-label="Notifications">
            <FiBell size={16} />
            <span className="admin-notif-dot" aria-hidden="true" />
          </button>

          {/* User avatar chip */}
          <div className="admin-avatar-chip" role="status" aria-label="Logged in as Admin">
            <div className="admin-avatar" aria-hidden="true">GG</div>
            <div className="admin-avatar-info">
              <span className="admin-avatar-name">Admin</span>
              <span className="admin-avatar-role">Super User</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
