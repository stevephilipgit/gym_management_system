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

export const canAccess = (role, allowedRoles) => {
  if (role === "superadmin") return true;
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) return true;
  return allowedRoles.includes(role);
};

export const AdminContext = createContext(null);

export const useAdmin = () => useContext(AdminContext);