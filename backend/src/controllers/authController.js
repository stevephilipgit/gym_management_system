// controllers/authController.js - Authentication and admin user management
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";
import logger from "../core/logger.js";
import env from "../core/config.js";
import { auditActions } from "../utils/auditLog.js";
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

export const authController = {
  // Login admin
  login: asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      throw new ValidationError("Username and password are required");
    }

    const admin = await Admin.findOne({ username });

    if (!admin) {
      throw new AuthError("Invalid credentials");
    }

    const passwordMatch = await bcrypt.compare(password, admin.passwordHash);

    if (!passwordMatch) {
      throw new AuthError("Invalid credentials");
    }

    // Generate JWT
    const token = jwt.sign(
      {
        id: admin._id,
        username: admin.username,
        role: admin.role,
        email: admin.email,
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES }
    );

    // Set cookie
    res.cookie("gym_admin_token", token, {
      httpOnly: true,
      secure: env.IS_PRODUCTION,
      sameSite: "strict",
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    // Audit log
    req.admin = { id: admin._id, username: admin.username };
    await auditActions.adminLogin(req, admin._id, true);

    return res.json({
      success: true,
      message: "Login successful",
      token,
      admin: {
        id: admin._id,
        username: admin.username,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
      },
    });
  }),

  // Logout admin
  logout: asyncHandler(async (req, res) => {
    const adminId = req.admin?.id;
    // Audit log only when authenticated context exists
    if (adminId) {
      await auditActions.adminLogout(req, adminId);
    }
    
    res.clearCookie("gym_admin_token");
    return res.json({ success: true, message: "Logged out successfully" });
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
    });
  }),

  // Create new admin (superadmin only)
  createAdmin: asyncHandler(async (req, res) => {
    const { username, password, fullName, email, role = "trainer" } = req.body;

    // Validate input
    if (!username || !password || !fullName || !email) {
      throw new ValidationError("All fields (username, password, fullName, email) are required");
    }

    // Validate role
    if (!["superadmin", "trainer", "finance"].includes(role)) {
      throw new ValidationError("Invalid role. Must be superadmin, trainer, or finance");
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
      },
    });
  }),

  // Update admin
  updateAdmin: asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { fullName, email, role } = req.body;

    const admin = await Admin.findById(id);

    if (!admin) {
      throw new ValidationError("Admin not found");
    }

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
    if (role && ["superadmin", "trainer", "finance"].includes(role)) {
      admin.role = role;
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
    await admin.save();

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
    await admin.save();

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

    if (!admin) {
      throw new ValidationError("No admin with this email");
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    admin.resetOtp = otp;
    admin.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await admin.save();

    // TODO: integrate email service (nodemailer)
    logger.info(`🔐 Password reset OTP for ${email}: ${otp}`);

    return res.json({
      success: true,
      message: "OTP sent to registered email (check console for demo)",
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
      throw new ValidationError("Invalid email or OTP");
    }

    // Verify OTP
    if (
      !admin.resetOtp ||
      !admin.otpExpiry ||
      admin.resetOtp !== otp ||
      admin.otpExpiry < new Date()
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
    admin.resetOtp = null;
    admin.otpExpiry = null;
    await admin.save();

    return res.json({
      success: true,
      message: "Password reset successfully",
    });
  }),
};

export default authController;
