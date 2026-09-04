import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { ToastProvider } from "./components/shared/ToastProvider";

/* PUBLIC */
const Home = lazy(() => import("./pages/Home"));
const Login = lazy(() => import("./pages/Login"));
const KioskAttendance = lazy(() => import("./pages/KioskAttendance"));

/* ADMIN */
import AuthGuard from "./admin/components/Authguard";
import RoleGuard from "./admin/RoleGuard.jsx";
const AdminLayout = lazy(() => import("./admin/AdminLayout"));
const AdminDashboardHome = lazy(() => import("./admin/AdminDashboardHome"));
const AdminRegister = lazy(() => import("./admin/AdminRegister"));
const AdminUpdate = lazy(() => import("./admin/AdminUpdate"));
const AdminMembers = lazy(() => import("./admin/AdminMembers"));
const AdminManagePackages = lazy(() => import("./admin/AdminManagePackages"));
const AdminManageFields = lazy(() => import("./admin/AdminManageFields"));
const AdminDietManager = lazy(() =>
  import("./admin/AdminDietManager").then((module) => ({ default: module.AdminDietManager }))
);
const AdminManageAdmins = lazy(() => import("./admin/AdminManageAdmins"));

/* ATTENDANCE + REPORTS */
const AttendanceFrontDesk = lazy(() => import("./admin/AttendanceFrontDesk"));
const InactiveReportsPage = lazy(() => import("./admin/InactiveReportsPage"));
const SettingsPage = lazy(() => import("./admin/SettingsPage"));
const AdminEnquiries = lazy(() => import("./admin/AdminEnquiries"));
const AttendanceDevices = lazy(() => import("./admin/AttendanceDevices"));
const AttendanceMyDevices = lazy(() => import("./admin/AttendanceMyDevices"));

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="page-frame py-10 text-center text-sm uppercase tracking-[0.24em] text-[var(--muted)]">
                Loading...
              </div>
            }
          >
            <Routes>
              {/* PUBLIC */}
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/kiosk-attendance" element={<KioskAttendance />} />

              {/* ADMIN (FULL PROTECTION) */}
              <Route
                path="/admin"
                element={
                  <AuthGuard>
                    <AdminLayout />
                  </AuthGuard>
                }
              >
                <Route
                  index
                  element={
                    <RoleGuard roles={["superadmin"]}>
                      <AdminDashboardHome />
                    </RoleGuard>
                  }
                />
                <Route path="members" element={<AdminMembers />} />
                <Route path="register" element={<AdminRegister />} />
                <Route path="update" element={<AdminUpdate />} />
                <Route path="packages" element={<RoleGuard roles={["superadmin"]}><AdminManagePackages /></RoleGuard>} />
                <Route path="fields" element={<RoleGuard roles={["superadmin"]}><AdminManageFields /></RoleGuard>} />
                <Route path="diet-manager" element={<AdminDietManager />} />
                <Route path="attendance-front-desk" element={<AttendanceFrontDesk />} />
                {/* Super Admin: global Device Management (RoleGuard enforced) */}
                <Route path="devices" element={<RoleGuard roles={["superadmin"]}><AttendanceDevices /></RoleGuard>} />
                {/* Trainer: My Attendance Devices (TRAINER-ONLY — exact role, no superadmin superset) */}
                <Route path="my-devices" element={<RoleGuard roles={["trainer"]} exact><AttendanceMyDevices /></RoleGuard>} />
                <Route path="inactivity-reports" element={<InactiveReportsPage />} />
                <Route path="settings" element={<RoleGuard roles={["superadmin"]}><SettingsPage /></RoleGuard>} />
                <Route path="admins" element={<RoleGuard roles={["superadmin"]}><AdminManageAdmins /></RoleGuard>} />
                <Route path="enquiries" element={<AdminEnquiries />} />
              </Route>

              <Route path="*" element={<Home />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;