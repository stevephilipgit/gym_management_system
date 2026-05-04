import { IoClose } from "react-icons/io5";
import { useLocation, useNavigate } from "react-router-dom";
import { FiCalendar, FiEdit, FiHome, FiInbox, FiLayers, FiLogOut, FiMenu, FiUserPlus, FiUsers, FiClock, FiBarChart2, FiSettings } from "react-icons/fi";
import apiClient from "../utils/apiClient.js";

export default function AdminSidebar({ closeSidebar, collapsed, setCollapsed }) {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { label: "Dashboard", icon: <FiHome />, path: "/admin" },
    { label: "Register Member", icon: <FiUserPlus />, path: "/admin/register" },
    { label: "View Dues", icon: <FiCalendar />, path: "/admin/due" },
    { label: "View All Members", icon: <FiUsers />, path: "/admin/members" },
    { label: "Update Member", icon: <FiEdit />, path: "/admin/update" },
    { label: "Manage Packages", icon: <FiLayers />, path: "/admin/packages" },
    { label: "Diet Manager", icon: <FiLayers />, path: "/admin/diet-manager" },
    { label: "AI Assistant", icon: <FiLayers />, path: "/admin/ai-assistant" },
    { label: "Edit Form Fields", icon: <FiEdit />, path: "/admin/fields" },
    // ✅ NEW: Attendance System
    { label: "Attendance", icon: <FiClock />, path: "/admin/attendance-front-desk" },
    { label: "Corrections", icon: <FiEdit />, path: "/admin/corrections" },
    { label: "Inactivity Reports", icon: <FiBarChart2 />, path: "/admin/inactivity-reports" },
    { label: "Enquiries", icon: <FiInbox />, path: "/admin/enquiries" },
    { label: "Settings", icon: <FiSettings />, path: "/admin/settings" },
  ];

  return (
    <aside className="glass-panel custom-scrollbar flex h-full flex-col overflow-y-auto border-r border-white/10 px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        {!collapsed && (
          <div>
            <p className="eyebrow">Admin Modules</p>
            <div className="text-lg font-extrabold tracking-[0.14em]">GIRI GYM</div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button className="btn-ghost hidden md:inline-flex" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <FiMenu /> : <IoClose />}
          </button>
          <button className="btn-ghost md:hidden" onClick={closeSidebar}>
            <IoClose />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-2">
        {menuItems.map((item) => {
          const isActive =
            location.pathname === item.path ||
            (item.path !== "/admin" && location.pathname.startsWith(item.path));

          return (
            <button
              key={item.label}
              onClick={() => {
                navigate(item.path);
                closeSidebar();
              }}
              className={`sidebar-link ${isActive ? "sidebar-link-active" : ""} ${collapsed ? "justify-center px-3" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar-dot" />
              <span className="text-lg">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => {
          apiClient.post("/admin/logout", {}).then(() => {
            window.location.href = "/login";
          });
        }}
        className={`btn-danger mt-6 ${collapsed ? "px-3" : ""}`}
      >
        <FiLogOut className="text-lg" />
        {!collapsed && "Logout"}
      </button>
    </aside>
  );
}
