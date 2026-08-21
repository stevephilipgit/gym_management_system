import { Navigate } from "react-router-dom";
import { canAccess, useAdmin } from "./authContext.js";

export default function RoleGuard({ roles, children }) {
  const admin = useAdmin();
  if (!canAccess(admin?.role, roles)) {
    // Redirect to the default trainer landing page rather than /admin, which
    // is itself superadmin-only (avoid an infinite redirect loop).
    return <Navigate to="/admin/members" replace />;
  }
  return children;
}