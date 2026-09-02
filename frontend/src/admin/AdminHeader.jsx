import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiMenu, FiBell } from "react-icons/fi";
import apiClient from "../utils/apiClient.js";

const ROLE_LABELS = {
  superadmin: "Super Admin",
  trainer: "Trainer",
};

const PAGE_TITLES = {
  "/admin": "Dashboard",
  "/admin/members": "All Members",
  "/admin/register": "Register Member",
  "/admin/update": "Update Member",
  "/admin/packages": "Packages",
  "/admin/fields": "Form Fields",
  "/admin/diet-manager": "Diet Manager",
  "/admin/attendance-front-desk": "Daily Attendance",
  "/admin/devices": "Device Management",
  "/admin/my-devices": "My Attendance Devices",
  "/admin/inactivity-reports": "Inactivity Reports",
  "/admin/settings": "Settings",
  "/admin/enquiries": "Enquiries",
};

const getInitials = (fullName, username) => {
  const source = (fullName || username || "").trim();
  if (!source) return "AD";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
};

export default function AdminHeader({ admin, toggleSidebar }) {
  const location  = useLocation();
  const navigate  = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const notifLoadingRef = useRef(false);
  const notifRef = useRef(null);

  const pageTitle = PAGE_TITLES[location.pathname] ?? "Dashboard";

  const fetchNotifications = useCallback(async () => {
    if (notifLoadingRef.current) return;
    notifLoadingRef.current = true;
    try {
      const res = await apiClient.get("/notifications?limit=20");
      setNotifications(res.data.notifications || []);
      setUnread(res.data.unread || 0);
    } catch {
      // Non-fatal: keep previous state; the bell still opens.
    } finally {
      notifLoadingRef.current = false;
    }
  }, []);

  // Refresh notifications when the bell is opened, and keep the badge fresh.
  useEffect(() => {
    if (!notifOpen) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [notifOpen, fetchNotifications]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onClick = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const markRead = async (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n._id === id ? { ...n, read: true } : n))
    );
    setUnread((u) => Math.max(0, u - 1));
    try {
      await apiClient.patch(`/notifications/${id}/read`);
    } catch {
      // Non-fatal: read state reverts on next refresh.
    }
  };

  const downloadReport = async (reportId) => {
    try {
      const res = await apiClient.get(`/exports/attendance/${reportId}/download`, {
        responseType: "blob",
      });
      const disposition = res.headers["content-disposition"] || "";
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match ? match[1] : `attendance-report-${reportId}.csv`;
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      // Silent: user can retry.
    }
  };

  const displayName = admin?.fullName || admin?.username || admin?.email || "Admin";
  const initials = getInitials(admin?.fullName, admin?.username);
  const roleLabel = admin?.role
    ? ROLE_LABELS[admin.role] || admin.role
    : "Admin";

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

          {/* Notification bell + dropdown (superadmin report notifications) */}
          <div className="admin-notif-wrap" ref={notifRef}>
            <button
              className="admin-notif-btn"
              aria-label="Notifications"
              aria-expanded={notifOpen}
              onClick={() => setNotifOpen((o) => !o)}
            >
              <FiBell size={16} />
              {unread > 0 && (
                <span className="admin-notif-badge">{unread}</span>
              )}
            </button>

            {notifOpen && (
              <div className="admin-notif-dropdown">
                <div className="admin-notif-head">Notifications</div>
                {notifications.length === 0 ? (
                  <div className="admin-notif-empty">No notifications</div>
                ) : (
                  <ul className="admin-notif-list">
                    {notifications.map((n) => (
                      <li
                        key={n._id}
                        className={`admin-notif-item${n.read ? " is-read" : ""}`}
                        onClick={() => {
                          if (!n.read) markRead(n._id);
                          // Device-request notifications navigate the trainer
                          // to their own device page. This is convenience only
                          // — the page fetches real state from the API.
                          if (n.type === "device_request") {
                            setNotifOpen(false);
                            navigate(admin?.role === "superadmin" ? "/admin/devices" : "/admin/my-devices");
                          }
                        }}
                      >
                        <div className="admin-notif-title">{n.title}</div>
                        {n.message ? (
                          <div className="admin-notif-msg">{n.message}</div>
                        ) : null}
                        {n.type === "export_ready" && n.reportId ? (
                          <button
                            type="button"
                            className="admin-notif-download"
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadReport(n.reportId);
                            }}
                          >
                            Download report
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* User avatar chip */}
          <div className="admin-avatar-chip" role="status" aria-label={`Logged in as ${displayName}`}>
            <div className="admin-avatar" aria-hidden="true">{initials}</div>
            <div className="admin-avatar-info">
              <span className="admin-avatar-name">{displayName}</span>
              <span className="admin-avatar-role">{roleLabel}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
