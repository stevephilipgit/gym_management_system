import { useState, useCallback } from "react";
import { validateField, hasErrors } from "../utils/validation";

/**
 * Custom hook for form validation
 * @param {object} initialValues - Initial form values
 * @param {object} schema - Validation schema
 * @returns {object} - Form state and methods
 */
export const useFormValidation = (initialValues = {}, schema = {}) => {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Handle field change
   */
  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    const fieldValue = type === "checkbox" ? checked : value;
    
    setValues((prev) => ({
      ...prev,
      [name]: fieldValue,
    }));

    // Validate on change if field is touched
    if (touched[name]) {
      validateSingleField(name, fieldValue);
    }
  }, [touched]);

  /**
   * Handle field blur
   */
  const handleBlur = useCallback((e) => {
    const { name } = e.target;
    setTouched((prev) => ({
      ...prev,
      [name]: true,
    }));
    
    validateSingleField(name, values[name]);
  }, [values]);

  /**
   * Validate a single field
   */
  const validateSingleField = useCallback((fieldName, value) => {
    const rules = schema[fieldName];
    if (!rules) return;

    let error = null;
    if (Array.isArray(rules)) {
      for (const rule of rules) {
        error = validateField(rule.type, value, {
          ...rule.options,
          fieldName: rule.label || fieldName,
        });
        if (error) break;
      }
    }

    setErrors((prev) => ({
      ...prev,
      [fieldName]: error,
    }));
  }, [schema]);

  /**
   * Validate all fields
   */
  const validateAll = useCallback(() => {
    const newErrors = {};

    for (const [fieldName, rules] of Object.entries(schema)) {
      const value = values[fieldName];
      if (!Array.isArray(rules)) continue;

      for (const rule of rules) {
        const error = validateField(rule.type, value, {
          ...rule.options,
          fieldName: rule.label || fieldName,
        });
        if (error) {
          newErrors[fieldName] = error;
          break;
        }
      }
    }

    setErrors(newErrors);
    return !hasErrors(newErrors);
  }, [values, schema]);

  /**
   * Handle form submit
   */
  const handleSubmit = useCallback((onSubmit) => {
    return async (e) => {
      e.preventDefault();
      
      // Mark all fields as touched
      const newTouched = {};
      Object.keys(schema).forEach((key) => {
        newTouched[key] = true;
      });
      setTouched(newTouched);

      // Validate all fields
      if (!validateAll()) {
        return;
      }

      // Submit
      setIsSubmitting(true);
      try {
        await onSubmit(values);
      } catch (error) {
        console.error("Form submission error:", error);
      } finally {
        setIsSubmitting(false);
      }
    };
  }, [schema, values, validateAll]);

  /**
   * Reset form
   */
  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
  }, [initialValues]);

  /**
   * Set field value
   */
  const setFieldValue = useCallback((name, value) => {
    setValues((prev) => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  /**
   * Set field error
   */
  const setFieldError = useCallback((name, error) => {
    setErrors((prev) => ({
      ...prev,
      [name]: error,
    }));
  }, []);

  /**
   * Get field error (only if touched)
   */
  const getFieldError = useCallback((fieldName) => {
    return touched[fieldName] ? errors[fieldName] : null;
  }, [errors, touched]);

  return {
    values,
    errors,
    touched,
    isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit,
    reset,
    setFieldValue,
    setFieldError,
    getFieldError,
    validateSingleField,
    validateAll,
  };
};
