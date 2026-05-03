/**
 * Frontend Validation Utility
 * Provides common validation functions for forms
 */

export const ValidationRules = {
  // Email validation
  email: (value) => {
    if (!value) return "Email is required";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return "Invalid email format";
    return null;
  },

  // Phone validation (Indian phone - 10 digits starting with 6-9)
  phone: (value) => {
    if (!value) return "Phone number is required";
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(value.replace(/\D/g, ""))) {
      return "Phone must start with 6-9 and be 10 digits";
    }
    return null;
  },

  // Aadhar validation (12 digits)
  aadhar: (value) => {
    if (!value) return "Aadhar is required";
    const aadharRegex = /^\d{12}$/;
    if (!aadharRegex.test(value.replace(/\D/g, ""))) {
      return "Aadhar must be 12 digits";
    }
    return null;
  },

  // Required field validation
  required: (value, fieldName = "This field") => {
    if (!value || value.trim() === "") {
      return `${fieldName} is required`;
    }
    return null;
  },

  // Min length validation
  minLength: (value, min, fieldName = "This field") => {
    if (!value) return null; // Required is separate
    if (value.trim().length < min) {
      return `${fieldName} must be at least ${min} characters`;
    }
    return null;
  },

  // Max length validation
  maxLength: (value, max, fieldName = "This field") => {
    if (!value) return null;
    if (value.length > max) {
      return `${fieldName} must not exceed ${max} characters`;
    }
    return null;
  },

  // Number-only validation
  numbersOnly: (value, fieldName = "This field") => {
    if (!value) return null;
    if (!/^\d+$/.test(value.replace(/\s/g, ""))) {
      return `${fieldName} must contain only numbers`;
    }
    return null;
  },

  // Date validation
  date: (value, fieldName = "Date") => {
    if (!value) return `${fieldName} is required`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return `${fieldName} is invalid`;
    }
    return null;
  },

  // Date not in future
  notInFuture: (value, fieldName = "Date") => {
    if (!value) return null;
    const date = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date > today) {
      return `${fieldName} cannot be in the future`;
    }
    return null;
  },

  // Age validation (from DOB)
  minAge: (value, minAge) => {
    if (!value) return null;
    const birthDate = new Date(value);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const month = today.getMonth() - birthDate.getMonth();
    if (month < 0 || (month === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    if (age < minAge) {
      return `Must be at least ${minAge} years old`;
    }
    return null;
  },

  // Dropdown/Selection validation
  select: (value, fieldName = "Selection") => {
    if (!value || value === "") {
      return `Please select a ${fieldName}`;
    }
    return null;
  },

  // Custom regex validation
  pattern: (value, pattern, message = "Invalid format") => {
    if (!value) return null;
    if (!pattern.test(value)) {
      return message;
    }
    return null;
  },

  // Numeric range validation
  range: (value, min, max, fieldName = "This field") => {
    if (!value) return null;
    const num = Number(value);
    if (Number.isNaN(num)) return `${fieldName} must be a number`;
    if (num < min || num > max) {
      return `${fieldName} must be between ${min} and ${max}`;
    }
    return null;
  },
};

/**
 * Validate a form field
 * @param {string} type - Validation type (email, phone, required, etc.)
 * @param {any} value - Value to validate
 * @param {object} options - Additional options (min, max, fieldName, etc.)
 * @returns {string|null} - Error message or null if valid
 */
export const validateField = (type, value, options = {}) => {
  const { fieldName = "This field", ...rest } = options;

  switch (type) {
    case "email":
      return ValidationRules.email(value);
    case "phone":
      return ValidationRules.phone(value);
    case "aadhar":
      return ValidationRules.aadhar(value);
    case "required":
      return ValidationRules.required(value, fieldName);
    case "minLength":
      return ValidationRules.minLength(value, rest.min, fieldName);
    case "maxLength":
      return ValidationRules.maxLength(value, rest.max, fieldName);
    case "numbersOnly":
      return ValidationRules.numbersOnly(value, fieldName);
    case "date":
      return ValidationRules.date(value, fieldName);
    case "notInFuture":
      return ValidationRules.notInFuture(value, fieldName);
    case "minAge":
      return ValidationRules.minAge(value, rest.age);
    case "select":
      return ValidationRules.select(value, fieldName);
    case "pattern":
      return ValidationRules.pattern(value, rest.pattern, rest.message);
    case "range":
      return ValidationRules.range(value, rest.min, rest.max, fieldName);
    default:
      return null;
  }
};

/**
 * Sanitize input values
 * @param {string} type - Sanitization type
 * @param {any} value - Value to sanitize
 * @returns {string} - Sanitized value
 */
export const sanitizeInput = (type, value) => {
  if (!value) return value;

  switch (type) {
    case "phone":
    case "aadhar":
    case "numbersOnly":
      return String(value).replace(/\D/g, "");
    case "trim":
      return String(value).trim();
    case "lowercase":
      return String(value).toLowerCase();
    case "uppercase":
      return String(value).toUpperCase();
    case "email":
      return String(value).trim().toLowerCase();
    case "noSpecialChars":
      return String(value).replace(/[^a-zA-Z0-9\s]/g, "");
    default:
      return value;
  }
};

/**
 * Validate an entire form object
 * @param {object} formData - Form data to validate
 * @param {object} schema - Validation schema { fieldName: [{ type, options }] }
 * @returns {object} - Errors object { fieldName: errorMessage }
 */
export const validateForm = (formData, schema) => {
  const errors = {};

  for (const [fieldName, rules] of Object.entries(schema)) {
    const value = formData[fieldName];
    
    if (Array.isArray(rules)) {
      for (const rule of rules) {
        const error = validateField(rule.type, value, {
          ...rule.options,
          fieldName: rule.label || fieldName,
        });
        if (error) {
          errors[fieldName] = error;
          break; // Stop at first error for this field
        }
      }
    }
  }

  return errors;
};

/**
 * Check if form has any errors
 * @param {object} errors - Errors object
 * @returns {boolean} - True if there are errors
 */
export const hasErrors = (errors) => {
  return Object.keys(errors).filter((key) => errors[key]).length > 0;
};
