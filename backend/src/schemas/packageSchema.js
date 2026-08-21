// schemas/packageSchema.js - Package validation schemas
import Joi from "joi";

export const createPackageSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  months: Joi.number().integer().min(1).max(24).required(),
  priceWeightLoss: Joi.number().min(0).required(),
  priceWeightGain: Joi.number().min(0).required(),
  priceTransformation: Joi.number().min(0).required(),
  gender: Joi.string().valid("All", "Male", "Female", "Transgender").optional(),
});

export const updatePackageSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  months: Joi.number().integer().min(1).max(24).optional(),
  priceWeightLoss: Joi.number().min(0).optional(),
  priceWeightGain: Joi.number().min(0).optional(),
  priceTransformation: Joi.number().min(0).optional(),
  gender: Joi.string().valid("All", "Male", "Female", "Transgender").optional(),
});

export const validateCreatePackage = (data) => createPackageSchema.validate(data, { abortEarly: false });
export const validateUpdatePackage = (data) => updatePackageSchema.validate(data, { abortEarly: false });
