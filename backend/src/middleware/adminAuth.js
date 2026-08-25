// middleware/adminAuth.js - JWT verification + server-side session validation
//
// STRICT per-session contract (no legacy shared-cookie fallback):
//   1. X-Session-Id header is REQUIRED (sent by the frontend from per-tab
//      sessionStorage). Without it the request is rejected.
//   2. The access JWT is read ONLY from the session-scoped cookie named
//      gym_admin_token_<sid>.
//   3. The JWT's `sid` claim MUST equal the header sid.
//   4. The JWT must verify; the admin must exist and be active with a
//      canonical role; admin.tokenVersion must match the token's `tv` claim.
//   5. The AdminSession (sessionId + adminId, revokedAt null, not expired)
//      must exist.
//
// The decoded identity is attached to req.admin for controllers. All
// authorization (role + gender scope) is performed downstream from req.admin.

import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import AdminSession from "../models/AdminSession.js";
import { accessCookieForSession } from "../utils/sessionCookies.js";
import config from "../config/index.js";

export default async function adminAuth(req, res, next) {
  try {
    const headerSid = String(req.get("x-session-id") || "").trim();

    // 1. X-Session-Id is mandatory — there is no legacy shared-cookie path.
    if (!headerSid) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    // 2. Read the access token from the session-scoped cookie only.
    const token = req.cookies[accessCookieForSession(headerSid)];
    if (!token) {
      return res.status(401).json({ message: "Unauthorized. Please login again." });
    }

    const decoded = jwt.verify(token, config.jwt.accessSecret);
    if (!decoded?.id || !decoded?.sid) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    // 3. The token's sid MUST equal the header sid.
    if (decoded.sid !== headerSid) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    const sessionId = decoded.sid;

    // 4. Load the admin (light projection) so account lifecycle is authoritative.
    const admin = await Admin.findById(decoded.id).select(
      "username role scope status tokenVersion"
    );
    if (!admin || admin.status !== "active") {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    // Canonical roles only — legacy roles (e.g. the removed `finance`) cannot
    // authenticate. Re-login with a corrected account is required.
    if (!["superadmin", "trainer"].includes(admin.role)) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    // Token version: any token issued before a tokenVersion bump is invalid.
    if (admin.tokenVersion !== decoded.tv) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    // 5. Session validity: revoke on logout, expire at refresh expiry.
    const session = await AdminSession.findOne({
      sessionId,
      adminId: admin._id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    // Refresh last-seen at most every 5 minutes to reduce write churn.
    if (!session.lastSeenAt || Date.now() - new Date(session.lastSeenAt).getTime() > 5 * 60 * 1000) {
      session.lastSeenAt = new Date();
      await session.save().catch(() => {});
    }

    req.admin = {
      id: admin._id,
      username: admin.username,
      role: admin.role,
      scope: admin.scope,
    };
    req.sessionId = sessionId;

    next();
  } catch (err) {
    return res.status(401).json({ message: "Session expired. Please login again." });
  }
}
