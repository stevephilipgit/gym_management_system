import { body, validationResult } from "express-validator";

export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array().map((error) => ({ field: error.path, message: error.msg })),
    });
  }
  next();
};

export const validateAdminLogin = [
  body("username").trim().isLength({ min: 3, max: 50 }).withMessage("Valid username is required"),
  body("password").isLength({ min: 6, max: 128 }).withMessage("Password must be 6-128 characters"),
  handleValidationErrors,
];

export const validateForgotPassword = [
  body("email").trim().isEmail().withMessage("Valid email is required").normalizeEmail(),
  handleValidationErrors,
];

export const validateResetPassword = [
  body("email").trim().isEmail().withMessage("Valid email is required").normalizeEmail(),
  body("otp").trim().isLength({ min: 6, max: 6 }).withMessage("OTP must be 6 characters"),
  body("newPassword")
    .isLength({ min: 8, max: 128 })
    .withMessage("Password must be 8-128 characters"),
  handleValidationErrors,
];

export const validateCreateAdmin = [
  body("username").trim().isLength({ min: 3, max: 50 }).withMessage("Valid username is required"),
  body("fullName").trim().isLength({ min: 2, max: 100 }).withMessage("Valid full name is required"),
  body("email").trim().isEmail().withMessage("Valid email is required").normalizeEmail(),
  body("password").isLength({ min: 8, max: 128 }).withMessage("Password must be 8-128 characters"),
  handleValidationErrors,
];
