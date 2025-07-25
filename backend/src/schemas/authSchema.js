// schemas/authSchema.js - Authentication validation schemas
import Joi from "joi";

export const loginSchema = Joi.object({
  username: Joi.string().min(3).max(50).required(),
  password: Joi.string().min(8).required(),
});

export const createAdminSchema = Joi.object({
  username: Joi.string().min(3).max(50).required(),
  password: Joi.string().min(8).pattern(/[A-Z]/).pattern(/[a-z]/).pattern(/[0-9]/).required(),
  fullName: Joi.string().min(3).max(100).required(),
  email: Joi.string().email().required(),
  role: Joi.string().valid("superadmin", "trainer", "finance").optional(),
});

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string()
    .min(8)
    .pattern(/[A-Z]/)
    .pattern(/[a-z]/)
    .pattern(/[0-9]/)
    .required(),
});

export const validateLogin = (data) => loginSchema.validate(data, { abortEarly: false });
export const validateCreateAdmin = (data) => createAdminSchema.validate(data, { abortEarly: false });
export const validateChangePassword = (data) => changePasswordSchema.validate(data, { abortEarly: false });
