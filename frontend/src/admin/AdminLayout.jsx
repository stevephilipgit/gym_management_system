import { useState } from "react";
import { Outlet } from "react-router-dom";
import AdminSidebar from "./AdminSidebar";
import AdminHeader from "./AdminHeader";

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <div
        className={`sidebar transition-transform duration-300 md:static ${
          sidebarOpen ? "fixed left-0 top-0 translate-x-0" : "hidden md:block"
        } ${collapsed ? "w-16" : "w-64"}`}
      >
        <AdminSidebar
          closeSidebar={() => setSidebarOpen(false)}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
        />
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Header */}
      <div className="header bg-[var(--bg-primary)]">
        <AdminHeader toggleSidebar={() => setSidebarOpen(true)} />
      </div>

      {/* Main Content */}
      <main className="main-content bg-[var(--bg-primary)]">
        <div className="page-frame h-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
