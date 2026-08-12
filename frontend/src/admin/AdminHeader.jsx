import { useLocation } from "react-router-dom";
import { FiMenu, FiBell } from "react-icons/fi";

const ROLE_LABELS = {
  superadmin: "Super Admin",
  trainer: "Trainer",
  finance: "Finance",
};

const SCOPE_LABELS = {
  all: "All Members",
  male: "Male Members",
  female_plus_transgender: "Female + Transgender Members",
};

const PAGE_TITLES = {
  "/admin": "Dashboard",
  "/admin/members": "All Members",
  "/admin/register": "Register Member",
  "/admin/update": "Update Member",
  "/admin/due": "View Dues",
  "/admin/packages": "Packages",
  "/admin/fields": "Form Fields",
  "/admin/diet-manager": "Diet Manager",
  "/admin/ai-assistant": "AI Assistant",
  "/admin/attendance-front-desk": "Daily Attendance",
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

  const pageTitle = PAGE_TITLES[location.pathname] ?? "Dashboard";

  const displayName = admin?.fullName || admin?.username || admin?.email || "Admin";
  const initials = getInitials(admin?.fullName, admin?.username);
  const roleLabel = admin?.role
    ? ROLE_LABELS[admin.role] || admin.role
    : "Admin";
  const scopeLabel = admin?.scope
    ? SCOPE_LABELS[admin.scope] || admin.scope
    : "All Members";

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

          {/* Notification bell */}
          <button className="admin-notif-btn" aria-label="Notifications">
            <FiBell size={16} />
            <span className="admin-notif-dot" aria-hidden="true" />
          </button>

          {/* User avatar chip */}
          <div className="admin-avatar-chip" role="status" aria-label={`Logged in as ${displayName}`}>
            <div className="admin-avatar" aria-hidden="true">{initials}</div>
            <div className="admin-avatar-info">
              <span className="admin-avatar-name">{displayName}</span>
              <span className="admin-avatar-role">{roleLabel}</span>
              <span className="admin-avatar-scope">{scopeLabel}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
