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
