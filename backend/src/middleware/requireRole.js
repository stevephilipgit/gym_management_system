// Route-level ROLE gate (string or array of allowed roles).
//
// Access-control matrix (two tiers, both enforced downstream):
//   superadmin ("Branch SuperAdmin") · full CRUD — every query additionally
//     partitioned to req.branchId by scopeResolver.buildBranchFilter /
//     buildGenderFilter (branch context attached by branchContext).
//   trainer · CREATE / READ / UPDATE only. DELETE is BLOCKED centrally in
//     middleware/branchContext.js (runs at adminAuth's tail, so it covers
//     every admin route — including routes that never stack requireRole).
//     Do NOT re-implement the delete guard here: one source of truth.
//
// Branch presence itself is validated by branchContext (403 when missing),
// which runs before this middleware in every chain (adminAuth → branchContext
// → requireRole).
export default function requireRole(requiredRole) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (Array.isArray(requiredRole)) {
      if (!requiredRole.includes(req.admin.role)) {
        return res.status(403).json({ message: "Access denied: insufficient role" });
      }
    } else {
      if (req.admin.role !== requiredRole) {
        return res.status(403).json({ message: "Access denied: insufficient role" });
      }
    }

    next();
  };
}
