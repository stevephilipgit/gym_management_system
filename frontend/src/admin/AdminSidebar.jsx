import { IoClose } from "react-icons/io5";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FiActivity,
  FiBarChart2,
  FiClock,
  FiCpu,
  FiHome,
  FiInbox,
  FiLogOut,
  FiMenu,
  FiPackage,
  FiSettings,
  FiSliders,
  FiUserPlus,
  FiUsers,
} from "react-icons/fi";
import apiClient from "../utils/apiClient.js";
import { clearSessionIdentity } from "../utils/sessionIdentity.js";
import { canAccess } from "./authContext.js";

// Navigation is the single role-aware menu definition.
// Items without a `roles` list are visible to every role.
// Restricted items list the roles allowed to see them
// (superadmin always passes via canAccess).
const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", icon: <FiHome />, path: "/admin", roles: ["superadmin"] },
    ],
  },
  {
    label: "Members",
    items: [
      { label: "Register Member", icon: <FiUserPlus />, path: "/admin/register" },
      { label: "All Members",    icon: <FiUsers />,    path: "/admin/members" },
    ],
  },
  {
    label: "Training",
    items: [
      { label: "Packages",     icon: <FiPackage />,  path: "/admin/packages",     roles: ["superadmin"] },
      { label: "Diet Manager", icon: <FiActivity />, path: "/admin/diet-manager" },
      { label: "AI Assistant", icon: <FiCpu />,      path: "/admin/ai-assistant", roles: ["superadmin"] },
      { label: "Form Fields",  icon: <FiSliders />,  path: "/admin/fields",       roles: ["superadmin"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Attendance",  icon: <FiClock />,     path: "/admin/attendance-front-desk" },
      { label: "Inactive Members",     icon: <FiBarChart2 />, path: "/admin/inactivity-reports" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Customer Enquiries", icon: <FiInbox />,    path: "/admin/enquiries" },
      { label: "Manage Accounts", icon: <FiUsers />, path: "/admin/admins", roles: ["superadmin"] },
      { label: "Settings",  icon: <FiSettings />, path: "/admin/settings", roles: ["superadmin"] },
    ],
  },
];

export default function AdminSidebar({ closeSidebar, collapsed, setCollapsed, admin }) {
  const navigate  = useNavigate();
  const location  = useLocation();

  const isActive = (path) =>
    location.pathname === path ||
    (path !== "/admin" && location.pathname.startsWith(path));

  const visibleGroups = NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccess(admin?.role, item.roles)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="admin-sidebar h-full flex flex-col">
      {/* ── Brand Header ───────────────────────────── */}
      <div className="admin-sidebar-header">
        <div className="admin-logo-wrap">
          <div className="admin-logo-mark" aria-hidden="true">GG</div>
          {!collapsed && (
            <div className="admin-logo-text">
              <span className="admin-logo-name">GIRI GYM</span>
              <span className="admin-logo-sub">Admin Panel</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            className="btn-ghost hidden md:inline-flex"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <FiMenu /> : <IoClose />}
          </button>
          <button
            className="btn-ghost md:hidden"
            onClick={closeSidebar}
            aria-label="Close sidebar"
          >
            <IoClose />
          </button>
        </div>
      </div>

      {/* ── Navigation ─────────────────────────────── */}
      <nav className="admin-sidebar-content flex-1 overflow-y-auto py-2 custom-scrollbar" aria-label="Admin navigation">
        {visibleGroups.map((group) => (
          <div key={group.label} className="admin-nav-group">
            {!collapsed && (
              <p className="admin-nav-group-label">{group.label}</p>
            )}
            <div className="admin-nav-items">
              {group.items.map((item) => {
                const active = isActive(item.path);
                return (
                  <button
                    key={item.label}
                    onClick={() => { navigate(item.path); closeSidebar(); }}
                    className={`sidebar-link ${active ? "sidebar-link-active" : ""} ${
                      collapsed ? "justify-center px-0" : ""
                    }`}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                  >
                    {active && !collapsed && <span className="sidebar-active-bar" aria-hidden="true" />}
                    <span className="sidebar-icon">{item.icon}</span>
                    {!collapsed && <span className="sidebar-label">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Logout ─────────────────────────────────── */}
      <div className="admin-sidebar-footer">
        <button
          onClick={() =>
            apiClient.post("/admin/logout", {}).finally(() => {
              clearSessionIdentity();
              window.location.href = "/login";
            })
          }
          className={`sidebar-logout ${collapsed ? "justify-center px-0" : ""}`}
          title={collapsed ? "Logout" : undefined}
        >
          <FiLogOut size={16} />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}
