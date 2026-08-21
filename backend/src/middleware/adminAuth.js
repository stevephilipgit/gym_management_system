// middleware/adminAuth.js - JWT verification + server-side session validation
//
// Supports per-session cookie names (gym_admin_token_<sid>) for multi-tab
// isolation within the same browser. The X-Session-Id header (set by the
// frontend from per-tab sessionStorage) tells the server which cookie pair to
// validate. Falls back to the legacy single cookie (gym_admin_token) for
// backward compatibility during the transition.
//
// Rejects requests when:
//   - no/expired/invalid access token
//   - the admin no longer exists or is disabled
//   - the admin.tokenVersion does not match the token's `tv` claim
//     (password change / admin disable / role change invalidate old tokens)
//   - the session identified by the token's `sid` claim was revoked or expired
//     (logout on one device never affects other devices)
//
// The decoded identity is attached to req.admin for controllers. All
// authorization (role + gender scope) is performed downstream from req.admin.

import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import AdminSession from "../models/AdminSession.js";
import { ACCESS_COOKIE, sessionCookieName } from "../utils/sessionCookies.js";
import config from "../config/index.js";

export default async function adminAuth(req, res, next) {
  try {
    const headerSid = String(req.get("x-session-id") || "").trim();

    // 1. Resolve the access token from the session-scoped cookie (X-Session-Id)
    //    or fall back to the legacy shared cookie.
    let token;
    if (headerSid) {
      token = req.cookies[sessionCookieName(headerSid, ACCESS_COOKIE)] || req.cookies[ACCESS_COOKIE];
    } else {
      token = req.cookies[ACCESS_COOKIE];
    }

    if (!token) {
      return res.status(401).json({ message: "Unauthorized. Please login again." });
    }

    const decoded = jwt.verify(token, config.jwt.accessSecret);
    if (!decoded?.id || !decoded?.sid) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    // 2. If the caller specified a session via header, it must match the token.
    if (headerSid && decoded.sid !== headerSid) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    const sessionId = decoded.sid;

    // 3. Load the admin (light projection) so account lifecycle is authoritative.
    const admin = await Admin.findById(decoded.id).select(
      "username role scope status tokenVersion"
    );
    if (!admin || admin.status !== "active") {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    // 4. Canonical roles only — legacy roles (e.g. the removed `finance`) cannot
    //    authenticate. Re-login with a corrected account is required.
    if (!["superadmin", "trainer"].includes(admin.role)) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    // 5. Token version: any token issued before a tokenVersion bump is invalid.
    if (admin.tokenVersion !== decoded.tv) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    // 6. Session validity: revoke on logout, expire at refresh expiry.
    const session = await AdminSession.findOne({
      sessionId,
      adminId: admin._id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    // 7. Refresh last-seen at most every 5 minutes to reduce write churn.
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