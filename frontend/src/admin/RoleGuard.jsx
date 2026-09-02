import { Navigate } from "react-router-dom";
import { canAccess, useAdmin } from "./authContext.js";

// RoleGuard restricts a route to specific roles.
//
// `exact` (default false): a Super Admin passes any `roles` list (semantic
// superset). Used for general admin modules.
//
// `exact={true}`: disables the superset — the role must be IN the `roles`
// list. Used ONLY for the Trainer-only "My Attendance Devices" route so a
// Super Admin is redirected instead of mounting the Trainer device UI.
export default function RoleGuard({ roles, children, exact }) {
  const admin = useAdmin();
  if (!canAccess(admin?.role, roles, { exact })) {
    // Redirect to the default trainer landing page rather than /admin, which
    // is itself superadmin-only (avoid an infinite redirect loop).
    return <Navigate to="/admin/members" replace />;
  }
  return children;
}
