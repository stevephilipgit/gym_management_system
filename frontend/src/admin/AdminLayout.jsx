import { useState } from "react";
import { Outlet } from "react-router-dom";
import AdminSidebar from "./AdminSidebar";
import AdminHeader from "./AdminHeader";

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="page-shell">
      <div className="flex min-h-screen overflow-hidden">
        <div
          className={`fixed left-0 top-0 z-40 h-screen transition-transform duration-300 md:static md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } ${collapsed ? "w-20" : "w-72"}`}
        >
          <AdminSidebar
            closeSidebar={() => setSidebarOpen(false)}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
          />
        </div>

        {sidebarOpen && (
          <div className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminHeader toggleSidebar={() => setSidebarOpen(true)} />

          <main className="flex-1 overflow-auto">
            <div className="page-frame py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
