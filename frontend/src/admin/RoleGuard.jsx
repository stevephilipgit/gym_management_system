import { Navigate } from "react-router-dom";
import { canAccess, useAdmin } from "./authContext.js";

export default function RoleGuard({ roles, children }) {
  const admin = useAdmin();
  if (!canAccess(admin?.role, roles)) {
    return <Navigate to="/admin" replace />;
  }
  return children;
}