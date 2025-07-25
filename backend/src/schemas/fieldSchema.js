// schemas/fieldSchema.js - Dynamic field validation schemas
import Joi from "joi";

export const createFieldSchema = Joi.object({
  label: Joi.string().min(2).max(100).required(),
  type: Joi.string()
    .valid("text", "number", "date", "dropdown")
    .required(),
  required: Joi.boolean().optional(),
  options: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string()).optional(),
});

export const updateFieldSchema = Joi.object({
  label: Joi.string().min(2).max(100).optional(),
  type: Joi.string()
    .valid("text", "number", "date", "dropdown")
    .optional(),
  required: Joi.boolean().optional(),
  isEnabled: Joi.boolean().optional(),
  options: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string()).optional(),
});

export const validateCreateField = (data) => createFieldSchema.validate(data, { abortEarly: false });
export const validateUpdateField = (data) => updateFieldSchema.validate(data, { abortEarly: false });
