import { createContext, useContext } from "react";

// Single source of truth for admin role-based access on the frontend.
// The backend remains the authority; this only surfaces/guards the UI.
//
// Canonical roles: superadmin | trainer | finance
//
// Rules:
//   - superadmin always has full access (semantic superset — a forgotten
//     role entry must never hide a module from the highest-privilege admin).
//   - An item/route without an explicit `roles` list is visible to every role.
//   - An item/route with a `roles` list is visible only to those roles.
//
// `exact` mode disables the superadmin superset. It is used ONLY for the
// Trainer-only "My Attendance Devices" feature: a Super Admin must not enter
// Trainer device-activation mode (Super Admin attendance is MODE 2 via
// /kiosk-attendance, never Trainer activation). Never enable `exact` for a
// module a Super Admin should be able to reach.

export const canAccess = (role, allowedRoles, { exact = false } = {}) => {
  if (!exact && role === "superadmin") return true;
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) return true;
  return allowedRoles.includes(role);
};

export const AdminContext = createContext(null);

export const useAdmin = () => useContext(AdminContext);