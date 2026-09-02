// controllers/authController.js - Authentication and admin user management
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import AdminSession from "../models/AdminSession.js";
import config from "../config/index.js";
import { auditActions } from "../utils/auditLog.js";
import { ACCESS_COOKIE, REFRESH_COOKIE, sessionCookieName, refreshCookieForSession } from "../utils/sessionCookies.js";
import captchaService from "../services/captchaService.js";
import { sendEmail } from "../services/emailService.js";
import { asyncHandler, ValidationError, AuthError, ConflictError } from "../core/errorHandler.js";

const validatePasswordStrength = (password) => {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one digit.";
  }
  return null;
};

// Convert jwt-style duration strings ("15m", "7d") to milliseconds.
const parseDurationToMs = (duration) => {
  if (typeof duration === "number") return duration;
  const match = String(duration).trim().match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = (match[2] || "m").toLowerCase();
  const multipliers = { ms: 1, s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return value * (multipliers[unit] || 60 * 1000);
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Session-scoped cookie names live in utils/sessionCookies.js (see import).

// Revoke every active session for an admin (password change, disable, delete).
const revokeAllSessions = async (adminId) => {
  await AdminSession.updateMany(
    { adminId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
};

// Build access + refresh JWTs for an admin session.
// Access token carries: id, username, role, scope, email, sid (session id),
// tv (tokenVersion) and a unique jti. The refresh token carries sid + tv so
// rotation stays bound to the same session.
const issueTokens = (admin, sessionId) => {
  const accessToken = jwt.sign(
    { id: admin._id, username: admin.username, role: admin.role, scope: admin.scope, email: admin.email, sid: sessionId, tv: admin.tokenVersion, jti: crypto.randomUUID() },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpires }
  );
  const refreshToken = jwt.sign(
    { id: admin._id, username: admin.username, sid: sessionId, tv: admin.tokenVersion, jti: crypto.randomUUID() },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpires }
  );
  return { accessToken, refreshToken };
};

// Set the per-session auth cookies (access + rotating refresh) on the response.
// Cookie names embed the session id so multiple sessions in one browser never
// overwrite each other. No legacy shared cookies are set or cleared.
const setAuthCookies = (res, { accessToken, refreshToken }, sessionId) => {
  res.cookie(sessionCookieName(sessionId, ACCESS_COOKIE), accessToken, {
    httpOnly: true,
    secure: config.app.isProduction,
    sameSite: "strict",
    path: "/",
    maxAge: parseDurationToMs(config.jwt.accessExpires),
  });
  res.cookie(sessionCookieName(sessionId, REFRESH_COOKIE), refreshToken, {
    httpOnly: true,
    secure: config.app.isProduction,
    sameSite: "strict",
    path: "/api/admin",
    maxAge: parseDurationToMs(config.jwt.refreshExpires),
  });
};

// Clear the per-session cookie pair for the given session.
const clearAuthCookies = (res, sessionId) => {
  if (sessionId) {
    res.clearCookie(sessionCookieName(sessionId, ACCESS_COOKIE), { path: "/" });
    res.clearCookie(sessionCookieName(sessionId, REFRESH_COOKIE), { path: "/api/admin" });
  }
};

// The session id a request identifies with. The X-Session-Id header is the
// ONLY source — there is no legacy shared-cookie fallback.
const resolveRequestSessionId = (req) => {
  const headerSid = String(req.get("x-session-id") || "").trim();
  return headerSid || null;
};

export const authController = {
  // GET captcha challenge (no authentication required)
  getCaptcha: asyncHandler(async (req, res) => {
    const { captchaId, svgBase64 } = await captchaService.create();
    return res.json({ success: true, captchaId, svgBase64 });
  }),

  // Login admin
  login: asyncHandler(async (req, res) => {
    const { username, password, captchaId, captchaAnswer } = req.body;

    // CAPTCHA is verified server-side BEFORE any credential processing.
    // The expected answer never leaves the server; verification consumes the
    // challenge (single-use) regardless of outcome.
    const captchaCheck = await captchaService.verify(captchaId, captchaAnswer);
    if (!captchaCheck.ok) {
      throw new ValidationError("Invalid or expired CAPTCHA. Please try again.");
    }

    if (!username || !password) {
      throw new ValidationError("Username and password are required");
    }

    const loginId = String(username).trim();
    const exactLoginRegex = new RegExp(`^${escapeRegExp(loginId)}$`, "i");
    const admin = await Admin.findOne({
      $or: [
        { username: exactLoginRegex },
        { email: exactLoginRegex },
      ],
    });

    // Generic failure covers: nonexistent user, disabled user, wrong password.
    if (!admin || admin.status !== "active") {
      throw new AuthError("Invalid credentials");
    }

    const passwordMatch = await bcrypt.compare(password, admin.passwordHash);

    if (!passwordMatch) {
      throw new AuthError("Invalid credentials");
    }

    // Create an independent per-device session. Logging out on one device
    // revokes only this session; other devices remain unaffected.
    const sessionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + parseDurationToMs(config.jwt.refreshExpires));
    await AdminSession.create({
      sessionId,
      adminId: admin._id,
      expiresAt,
      deviceName: String(req.get("user-agent") || "").substring(0, 200),
      ip: String(req.ip || "").substring(0, 45),
    });

    // Generate access + refresh JWTs bound to the session
    const { accessToken, refreshToken } = issueTokens(admin, sessionId);

    // Set per-session cookies (access + rotating refresh)
    setAuthCookies(res, { accessToken, refreshToken }, sessionId);

    admin.lastLogin = new Date();
    await admin.save().catch(() => {});

    // Audit log
    req.admin = { id: admin._id, username: admin.username };
    await auditActions.adminLogin(req, admin._id, true);

    return res.json({
      success: true,
      message: "Login successful",
      token: accessToken,
      sessionId,
      admin: {
        id: admin._id,
        username: admin.username,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        scope: admin.scope,
      },
    });
  }),

  // Refresh the admin session by rotating the access + refresh tokens.
  // The X-Session-Id header is REQUIRED and identifies the cookie pair.
  refreshToken: asyncHandler(async (req, res) => {
    const requestedSid = resolveRequestSessionId(req);

    if (!requestedSid) {
      throw new AuthError("Session expired. Please login again.");
    }

    // Read the session-scoped refresh cookie only.
    const refreshToken = req.cookies[refreshCookieForSession(requestedSid)];

    if (!refreshToken) {
      throw new AuthError("Session expired. Please login again.");
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    } catch (err) {
      clearAuthCookies(res, requestedSid);
      throw new AuthError("Session expired. Please login again.");
    }

    if (!decoded?.id || !decoded?.sid) {
      clearAuthCookies(res, requestedSid);
      throw new AuthError("Session expired. Please login again.");
    }

    // The session identified in the header/legacy cookie must match the token.
    if (requestedSid && decoded.sid !== requestedSid) {
      clearAuthCookies(res, requestedSid);
      throw new AuthError("Session expired. Please login again.");
    }

    const sessionId = decoded.sid;

    const admin = await Admin.findById(decoded.id).select("-passwordHash");

    if (!admin || admin.status !== "active") {
      clearAuthCookies(res, sessionId);
      throw new AuthError("Session expired. Please login again.");
    }

    // tokenVersion changed (password change / disable / role change) → invalid
    if (admin.tokenVersion !== decoded.tv) {
      clearAuthCookies(res, sessionId);
      throw new AuthError("Session expired. Please login again.");
    }

    // Session must still exist, be un-revoked and un-expired
    const session = await AdminSession.findOne({
      sessionId,
      adminId: admin._id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      clearAuthCookies(res, sessionId);
      throw new AuthError("Session expired. Please login again.");
    }

    // Rotate tokens so a stolen refresh token can only be used once.
    const { accessToken, refreshToken: newRefreshToken } = issueTokens(admin, session.sessionId);
    setAuthCookies(res, { accessToken, refreshToken: newRefreshToken }, session.sessionId);

    session.lastSeenAt = new Date();
    await session.save().catch(() => {});

    return res.json({
      success: true,
      message: "Session refreshed",
      token: accessToken,
      sessionId: session.sessionId,
      admin: {
        id: admin._id,
        username: admin.username,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        scope: admin.scope,
      },
    });
  }),

  // Logout admin: revoke the CURRENT session only. Other devices' sessions
  // are unaffected. The X-Session-Id header is the session identifier.
  // Works even with an expired access token (the header sid is a capability).
  logout: asyncHandler(async (req, res) => {
    const sessionId = resolveRequestSessionId(req);
    let adminId = null;

    if (sessionId) {
      // Resolve the admin for audit before revoking the session.
      const session = await AdminSession.findOne({ sessionId }).catch(() => null);
      if (session) adminId = session.adminId;
      await AdminSession.updateOne({ sessionId }, { $set: { revokedAt: new Date() } }).catch(() => {});
    }

    if (adminId) {
      req.admin = { id: adminId };
      await auditActions.adminLogout(req, adminId).catch(() => {});
    }

    clearAuthCookies(res, sessionId);
    return res.json({ success: true, message: "Logged out successfully" });
  }),

  // Logout all sessions for the current admin (e.g., a lost device).
  logoutAllSessions: asyncHandler(async (req, res) => {
    const adminId = req.admin?.id;
    const sessionId = req.sessionId || resolveRequestSessionId(req);
    if (adminId) {
      await revokeAllSessions(adminId);
      await auditActions.adminLogout(req, adminId).catch(() => {});
    }
    clearAuthCookies(res, sessionId);
    return res.json({ success: true, message: "All sessions logged out" });
  }),

  // Get current admin
  getCurrentAdmin: asyncHandler(async (req, res) => {
    const adminId = req.admin.id;
    const admin = await Admin.findById(adminId).select("-passwordHash");

    if (!admin) {
      throw new AuthError("Admin not found");
    }

    return res.json({
      success: true,
      data: admin,
      admin,
      sessionId: req.sessionId,
    });
  }),

  // Update the calling admin's stored UI preferences (per-admin persistence).
  // The body is merged at the top level so unrelated preference keys survive.
  updatePreferences: asyncHandler(async (req, res) => {
    const admin = await Admin.findById(req.admin.id);
    if (!admin) {
      throw new AuthError("Admin not found");
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    admin.preferences = { ...(admin.preferences || {}), ...body };
    await admin.save();

    return res.json({
      success: true,
      preferences: admin.preferences,
    });
  }),

  // Create new admin (superadmin only)
  createAdmin: asyncHandler(async (req, res) => {
    const { username, password, fullName, email, role, scope } = req.body;

    // Validate input
    if (!username || !password || !fullName || !email) {
      throw new ValidationError("All fields (username, password, fullName, email) are required");
    }

    // Validate role
    if (!["superadmin", "trainer"].includes(role)) {
      throw new ValidationError("Invalid role. Must be superadmin or trainer");
    }

    // Validate scope — REQUIRED so trainers cannot be created with full access
    // by accident. "all" is only meaningful for superadmin.
    if (!["all", "male", "female_plus_transgender"].includes(scope)) {
      throw new ValidationError("Scope is required. Must be all, male, or female_plus_transgender");
    }
    if (role === "trainer" && scope === "all") {
      throw new ValidationError("Trainers must have a gender scope (male or female_plus_transgender)");
    }

    // Validate password strength
    const pwErr = validatePasswordStrength(password);
    if (pwErr) {
      throw new ValidationError(pwErr);
    }

    // Check if username exists
    const existingUser = await Admin.findOne({ username });
    if (existingUser) {
      throw new ConflictError("Username already exists");
    }

    // Check if email exists
    const existingEmail = await Admin.findOne({ email });
    if (existingEmail) {
      throw new ConflictError("Email already in use");
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create admin
    const admin = new Admin({
      username,
      fullName,
      email,
      role,
      scope,
      passwordHash,
    });

    await admin.save();

    return res.status(201).json({
      success: true,
      message: "Admin created successfully",
      data: {
        id: admin._id,
        username: admin.username,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        scope: admin.scope,
      },
    });
  }),

  // Update admin
  updateAdmin: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { fullName, email, role, scope, status } = req.body;

    const admin = await Admin.findById(id);

    if (!admin) {
      throw new ValidationError("Admin not found");
    }

    // Track lifecycle-affecting changes so we can invalidate all sessions.
    let lifecycleChanged = false;

    // Update fields
    if (fullName) admin.fullName = fullName;
    if (email) {
      // Check if email is already in use by another admin
      const existingEmail = await Admin.findOne({ email, _id: { $ne: id } });
      if (existingEmail) {
        throw new ConflictError("Email already in use");
      }
      admin.email = email;
    }
    if (role && ["superadmin", "trainer"].includes(role) && role !== admin.role) {
      admin.role = role;
      lifecycleChanged = true;
    }
    if (scope && ["all", "male", "female_plus_transgender"].includes(scope) && scope !== admin.scope) {
      admin.scope = scope;
      lifecycleChanged = true;
      // SCOPE CHANGE (MODE 1): revoke the Trainer's active attendance devices
      // and unused activations so no stale scope authority remains active.
      // The Trainer must generate + redeem a fresh activation under the new
      // scope. This must run before saving so device revocation reflects the
      // new scope state atomically with the session invalidation.
      if (admin.role === "trainer") {
        const { revokeTrainerRegistrations } = await import("../services/deviceRegistrationService.js");
        const DeviceActivation = (await import("../models/DeviceActivation.js")).default;
        await revokeTrainerRegistrations({ trainerId: admin._id });
        await DeviceActivation.updateMany(
          { trainerId: admin._id, usedAt: null, revokedAt: null },
          { $set: { revokedAt: new Date() } }
        );
        const { auditLog } = await import("../utils/auditLog.js");
        await auditLog(req, {
          action: (await import("../core/constants.js")).ACTION_TYPES.SCOPE_CHANGED,
          status: "SUCCESS",
          resourceType: "Admin",
          resourceId: String(admin._id),
          changes: { scope },
        });
      }
    }
    if (status && ["active", "disabled"].includes(status) && status !== admin.status) {
      admin.status = status;
      lifecycleChanged = true;
    }

    if (lifecycleChanged) {
      // Invalidate every outstanding token so new role/scope/status take effect
      admin.tokenVersion = (admin.tokenVersion || 0) + 1;
      await revokeAllSessions(admin._id);
    }

    await admin.save();

    return res.json({
      success: true,
      message: "Admin updated successfully",
      data: {
        id: admin._id,
        username: admin.username,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        scope: admin.scope,
        status: admin.status,
      },
    });
  }),

  // Delete admin
  deleteAdmin: asyncHandler(async (req, res) => {
    const { id } = req.params;

    const admin = await Admin.findByIdAndDelete(id);

    if (!admin) {
      throw new ValidationError("Admin not found");
    }

    // Terminate every session held by the deleted admin
    await AdminSession.deleteMany({ adminId: admin._id });

    return res.json({
      success: true,
      message: "Admin deleted successfully",
    });
  }),

  // List all admins (superadmin only)
  listAdmins: asyncHandler(async (req, res) => {
    const admins = await Admin.find({}).select("-passwordHash").sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: admins,
      count: admins.length,
    });
  }),

  // Change password
  changePassword: asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const adminId = req.admin.id;

    if (!currentPassword || !newPassword) {
      throw new ValidationError("Current password and new password are required");
    }

    const admin = await Admin.findById(adminId);

    if (!admin) {
      throw new AuthError("Admin not found");
    }

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, admin.passwordHash);

    if (!passwordMatch) {
      throw new AuthError("Current password is incorrect");
    }

    // Validate new password strength
    const pwErr = validatePasswordStrength(newPassword);
    if (pwErr) {
      throw new ValidationError(pwErr);
    }

    // Hash and save new password
    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    await admin.save();

    // Password change revokes every existing session (all devices).
    await revokeAllSessions(admin._id);
    clearAuthCookies(res);

    return res.json({
      success: true,
      message: "Password changed successfully",
    });
  }),

  // Reset password (superadmin only - generates temp password)
  resetAdminPassword: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const tempPassword = Math.random().toString(36).slice(-8) + "Aa1!";

    const admin = await Admin.findById(id);

    if (!admin) {
      throw new ValidationError("Admin not found");
    }

    admin.passwordHash = await bcrypt.hash(tempPassword, 10);
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    await admin.save();

    // Terminate all active sessions so the new password is enforced everywhere.
    await revokeAllSessions(admin._id);

    return res.json({
      success: true,
      message: "Password reset successfully",
      tempPassword: tempPassword,
      note: "Admin should change this temporary password immediately",
    });
  }),

  // Forgot password - send OTP
  forgotPassword: asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      throw new ValidationError("Email is required");
    }

    const admin = await Admin.findOne({ email });

    // Generic response prevents account enumeration.
    if (!admin) {
      return res.json({
        success: true,
        message: "If an account exists for this email, an OTP has been sent.",
      });
    }

    // Generate OTP with cryptographically secure random
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    admin.resetOtp = otpHash;
    admin.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
    await admin.save();

    // Delivery via the existing email service (SMTP configured at deploy time).
    // No OTP is ever logged or returned in an API response.
    await sendEmail({
      to: email,
      subject: "Giri Gym - Password Reset OTP",
      text: `Your password reset OTP is ${otp}. It expires in 10 minutes.`,
      html: `<p>Your password reset OTP is <strong>${otp}</strong>.</p><p>It expires in 10 minutes.</p>`,
    });

    return res.json({
      success: true,
      message: "If an account exists for this email, an OTP has been sent.",
    });
  }),

  // Reset password with OTP
  resetPasswordWithOTP: asyncHandler(async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      throw new ValidationError("Email, OTP, and new password are required");
    }

    const admin = await Admin.findOne({ email });

    if (!admin) {
      throw new ValidationError("Invalid or expired OTP");
    }

    const otpHash = crypto.createHash("sha256").update(String(otp)).digest("hex");

    // Verify OTP against the stored hash (never plaintext)
    if (
      !admin.resetOtp ||
      !admin.otpExpiry ||
      admin.resetOtp !== otpHash ||
      admin.otpExpiry < Date.now()
    ) {
      throw new ValidationError("Invalid or expired OTP");
    }

    // Validate password strength
    const pwErr = validatePasswordStrength(newPassword);
    if (pwErr) {
      throw new ValidationError(pwErr);
    }

    // Hash and save new password
    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    admin.resetOtp = null;
    admin.otpExpiry = null;
    await admin.save();

    // Revoke every session — the OTP reset applies to all devices.
    await revokeAllSessions(admin._id);
    clearAuthCookies(res);

    return res.json({
      success: true,
      message: "Password reset successfully",
    });
  }),
};

export default authController;
