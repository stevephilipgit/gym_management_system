// middleware/adminAttendanceAuth.js - Super Admin scoped-attendance token auth
//
// MODE 2: A Super Admin uses /kiosk-attendance with an explicitly chosen scope.
// The client first obtains a short-lived scoped-attendance token via
// POST /api/attendance/admin-scope, then sends it as X-Admin-Attendance-Token
// on punch requests.
//
// This is a SEPARATE credential from the normal login JWT. It is NOT kioskAuth,
// and a normal login JWT is never accepted here (and this token is never
// accepted by kioskAuth).
//
// Validation performed here:
//   - signature (dedicated secret, with documented access-secret fallback)
//   - issuer, audience, purpose, algorithm
//   - expiry
//   - scope ∈ { male, female_plus_transgender }
//   - the admin is CURRENTLY a superadmin and active (DB re-check, never trust
//     the role claim alone)

import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import config from "../config/index.js";

const ALLOWED_SCOPES = new Set(["male", "female_plus_transgender"]);
const PURPOSE = "superadmin_attendance";

export default async function adminAttendanceAuth(req, res, next) {
  try {
    const token = String(req.get("x-admin-attendance-token") || "").trim();
    if (!token) {
      return res.status(401).json({ message: "Unauthorized. Please select a scope." });
    }

    const decoded = jwt.verify(token, config.jwt.adminAttendanceSecret, {
      algorithms: ["HS256"],
      issuer: config.jwt.adminAttendanceIssuer,
      audience: config.jwt.adminAttendanceAudience,
    });

    if (!decoded || decoded.purpose !== PURPOSE) {
      return res.status(401).json({ message: "Unauthorized. Please select a scope." });
    }
    if (!decoded.adminId || !ALLOWED_SCOPES.has(decoded.scope)) {
      return res.status(401).json({ message: "Unauthorized. Please select a scope." });
    }
    if (typeof decoded.exp !== "number" || decoded.exp * 1000 < Date.now()) {
      return res.status(401).json({ message: "Attendance scope expired. Please select a scope again." });
    }

    // DB re-check — never trust the role claim alone.
    const admin = await Admin.findById(decoded.adminId).select("role scope status").lean();
    if (!admin || admin.role !== "superadmin" || admin.status !== "active") {
      return res.status(403).json({ message: "Access denied: insufficient role" });
    }

    req.attendancePrincipal = {
      type: "superadmin",
      adminId: String(admin._id),
      scope: decoded.scope,
    };

    next();
  } catch (err) {
    // Signature / issuer / audience / expiry failure → generic 401.
    return res.status(401).json({ message: "Unauthorized. Please select a scope." });
  }
}
