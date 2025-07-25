// schemas/dietSchema.js - Diet validation schemas
import Joi from "joi";

export const createDietSchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  description: Joi.string().max(1000).optional(),
  isActive: Joi.boolean().optional(),
});

export const updateDietSchema = Joi.object({
  name: Joi.string().min(3).max(100).optional(),
  description: Joi.string().max(1000).optional(),
  isActive: Joi.boolean().optional(),
});

export const validateCreateDiet = (data) => createDietSchema.validate(data, { abortEarly: false });
export const validateUpdateDiet = (data) => updateDietSchema.validate(data, { abortEarly: false });
