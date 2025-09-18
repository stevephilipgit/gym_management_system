import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

/* PUBLIC */
const Home = lazy(() => import("./pages/Home"));
const Login = lazy(() => import("./pages/Login"));

/* ADMIN */
import AuthGuard from "./admin/components/Authguard";
const AdminLayout = lazy(() => import("./admin/AdminLayout"));
const AdminDashboardHome = lazy(() => import("./admin/AdminDashboardHome"));
const AdminRegister = lazy(() => import("./admin/AdminRegister"));
const AdminUpdate = lazy(() => import("./admin/AdminUpdate"));
const AdminDues = lazy(() => import("./admin/AdminDues"));
const AdminMembers = lazy(() => import("./admin/AdminMembers"));
const AdminManagePackages = lazy(() => import("./admin/AdminManagePackages"));
const AdminManageFields = lazy(() => import("./admin/AdminManageFields"));
const AdminDietManager = lazy(() =>
  import("./admin/AdminDietManager").then((module) => ({ default: module.AdminDietManager }))
);
const AiAssistant = lazy(() => import("./components/AiAssistant/AiAssistant"));

// ✅ NEW: Attendance System Pages
const AttendanceFrontDesk = lazy(() => import("./admin/AttendanceFrontDesk"));
const CorrectionPanel = lazy(() => import("./admin/CorrectionPanel"));
const InactiveReportsPage = lazy(() => import("./admin/InactiveReportsPage"));
const SettingsPage = lazy(() => import("./admin/SettingsPage"));


function App() {
  return (
    <BrowserRouter>
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

          {/* ADMIN (FULL PROTECTION) */}
          <Route
            path="/admin"
            element={
              <AuthGuard>
                <AdminLayout />
              </AuthGuard>
            }
          >
            <Route index element={<AdminDashboardHome />} />
            <Route path="members" element={<AdminMembers />} />
            <Route path="register" element={<AdminRegister />} />
            <Route path="update" element={<AdminUpdate />} />
            <Route path="due" element={<AdminDues />} />
            <Route path="packages" element={<AdminManagePackages />} />
            <Route path="fields" element={<AdminManageFields />} />
            <Route path="diet-manager" element={<AdminDietManager />} />
            <Route path="ai-assistant" element={<AiAssistant />} />
            {/* ✅ NEW: Attendance System Routes */}
            <Route path="attendance-front-desk" element={<AttendanceFrontDesk />} />
            <Route path="corrections" element={<CorrectionPanel />} />
            <Route path="inactivity-reports" element={<InactiveReportsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
