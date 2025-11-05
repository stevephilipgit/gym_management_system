// middleware/schemaValidator.js - Joi schema validation middleware
import { ValidationError } from "../core/errorHandler.js";

export const validateSchema = (schema) => (req, res, next) => {
  try {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      const validationError = new ValidationError("Validation failed", details);
      return next(validationError);
    }

    req.validatedBody = value;
    next();
  } catch (err) {
    next(err);
  }
};

export const validateQuery = (schema) => (req, res, next) => {
  try {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
    });

    if (error) {
      const details = error.details.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      const validationError = new ValidationError("Query validation failed", details);
      return next(validationError);
    }

    req.validatedQuery = value;
    next();
  } catch (err) {
    next(err);
  }
};

export const validateParams = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.params, {
    abortEarly: false,
  });

  if (error) {
    const details = error.details.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));
    throw new ValidationError("Param validation failed", details);
  }

  req.validatedParams = value;
  next();
};
