import { useState } from "react";
import { Outlet } from "react-router-dom";
import AdminSidebar from "./AdminSidebar";
import AdminHeader from "./AdminHeader";
import useMediaQuery from "../hooks/useMediaQuery.js";

export default function AdminLayout({ admin }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Desktop/tablet layout >= 768px. On mobile the sidebar is a drawer and
  // must ALWAYS render expanded (icons + labels); the desktop collapse
  // toggle only affects desktop/tablet and never leaks into mobile.
  const isDesktopLayout = useMediaQuery("(min-width: 768px)");
  const effectiveCollapsed = isDesktopLayout && collapsed;

  return (
    <div className={`app-layout ${effectiveCollapsed ? "sidebar-collapsed" : ""}`}>
      {/* Sidebar — in-flow grid column on desktop/tablet, off-canvas
          drawer on mobile. open/closed classes only drive the drawer. */}
      <div className={`sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-closed"} ${effectiveCollapsed ? "collapsed" : ""}`}>
        <AdminSidebar
          closeSidebar={() => setSidebarOpen(false)}
          collapsed={effectiveCollapsed}
          setCollapsed={setCollapsed}
          admin={admin}
        />
      </div>

      {/* Mobile backdrop — closes the drawer (hidden on md+) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Header */}
      <div className="header bg-[var(--bg-primary)]">
        <AdminHeader admin={admin} toggleSidebar={() => setSidebarOpen(true)} />
      </div>

      {/* Main Content */}
      <main className="main-content bg-[var(--bg-primary)]">
        <div className="page-frame admin-page-frame h-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
