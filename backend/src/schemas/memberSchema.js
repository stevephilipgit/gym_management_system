// schemas/memberSchema.js - Member validation schemas
import Joi from "joi";

export const memberRegisterSchema = Joi.object({
  fullName: Joi.string()
    .trim()
    .min(3)
    .max(100)
    .required()
    .messages({
      "string.empty": "Full Name is required",
      "string.min": "Full Name must be at least 3 characters",
      "string.max": "Full Name must not exceed 100 characters",
    }),
  
  fatherName: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({
      "string.empty": "Father Name is required",
      "string.min": "Father Name must be at least 2 characters",
      "string.max": "Father Name must not exceed 100 characters",
    }),
  
  phone: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
      "string.empty": "Phone number is required",
      "string.pattern.base": "Phone must start with 6-9 and be 10 digits",
    }),
  
  email: Joi.string()
    .email()
    .optional()
    .messages({
      "string.email": "Invalid email format",
    }),
  
  dob: Joi.date()
    .required()
    .messages({
      "date.base": "Invalid date of birth",
      "any.required": "Date of birth is required",
    }),
  
  bloodGroup: Joi.string()
    .valid("A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-")
    .required()
    .messages({
      "any.only": "Invalid blood group",
      "any.required": "Blood group is required",
    }),
  
  gender: Joi.string()
    .valid("Male", "Female", "Transgender")
    .required()
    .messages({
      "any.only": "Gender must be Male, Female, or Transgender",
      "any.required": "Gender is required",
    }),
  
  aadhar: Joi.string()
    .pattern(/^\d{12}$/)
    .required()
    .messages({
      "string.empty": "Aadhar is required",
      "string.pattern.base": "Aadhar must be 12 digits",
    }),
  
  occupation: Joi.string()
    .trim()
    .max(100)
    .required()
    .messages({
      "string.empty": "Occupation is required",
      "string.max": "Occupation must not exceed 100 characters",
    }),
  
  address: Joi.string()
    .trim()
    .max(500)
    .required()
    .messages({
      "string.empty": "Address is required",
      "string.max": "Address must not exceed 500 characters",
    }),
  
  medicalIssues: Joi.string()
    .trim()
    .max(1000)
    .optional()
    .messages({
      "string.max": "Medical Issues must not exceed 1000 characters",
    }),
  
  gymPlan: Joi.string()
    .trim()
    .max(50)
    .required()
    .messages({
      "string.empty": "Gym Plan is required",
    }),
  
  trainingType: Joi.string()
    .valid("Weight Loss", "Weight Gain", "Transformation")
    .required()
    .messages({
      "any.only": "Invalid training type",
      "any.required": "Training type is required",
    }),
  
  paymentStatus: Joi.string()
    .valid("paid", "not_paid")
    .optional()
    .messages({
      "any.only": "Payment status must be paid or not_paid",
    }),
  
  paymentMode: Joi.string()
    .valid("cash", "gpay", "card")
    .optional()
    .messages({
      "any.only": "Invalid payment mode",
    }),
  
  amount: Joi.number()
    .positive()
    .optional()
    .messages({
      "number.positive": "Amount must be positive",
    }),
  
  dietId: Joi.string()
    .hex()
    .length(24)
    .optional()
    .messages({
      "string.hex": "Invalid diet ID",
    }),
  
  customFields: Joi.alternatives()
    .try(Joi.object(), Joi.string())
    .optional(),
}).unknown(true);

export const memberUpdateSchema = Joi.object({
  fullName: Joi.string()
    .trim()
    .min(3)
    .max(100)
    .optional(),
  
  fatherName: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .optional(),
  
  dob: Joi.date().optional(),
  
  occupation: Joi.string()
    .trim()
    .max(100)
    .optional(),
  
  gender: Joi.string()
    .valid("Male", "Female", "Transgender")
    .optional(),
  
  trainingType: Joi.string()
    .valid("Weight Loss", "Weight Gain", "Transformation")
    .optional(),
  
  gymPlan: Joi.string()
    .trim()
    .max(50)
    .optional(),
  
  aadhar: Joi.string()
    .pattern(/^\d{12}$/)
    .optional()
    .messages({
      "string.pattern.base": "Aadhar must be 12 digits",
    }),
  
  phone: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .optional()
    .messages({
      "string.pattern.base": "Phone must start with 6-9 and be 10 digits",
    }),
  
  email: Joi.string()
    .email()
    .optional(),
  
  bloodGroup: Joi.string()
    .valid("A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-")
    .optional(),
  
  address: Joi.string()
    .trim()
    .max(500)
    .optional(),
  
  medicalIssues: Joi.string()
    .trim()
    .max(1000)
    .optional(),
  
  status: Joi.string()
    .valid("active", "inactive", "suspended", "expired", "archived")
    .optional(),
  
  dietId: Joi.string()
    .hex()
    .length(24)
    .optional(),
  
  customFields: Joi.alternatives()
    .try(Joi.object(), Joi.string())
    .optional(),
}).unknown(true);

export const memberSearchSchema = Joi.object({
  q: Joi.string().min(2).max(100).required(),
});

export const memberStatusSchema = Joi.object({
  status: Joi.string().valid("active", "inactive", "suspended", "expired", "archived").required(),
});

export const memberRenewSchema = Joi.object({
  plan: Joi.string()
    .trim()
    .max(50)
    .optional(),
  
  newPlan: Joi.string()
    .trim()
    .max(50)
    .optional(),
  
  amount: Joi.number()
    .positive()
    .optional()
    .messages({
      "number.positive": "Amount must be positive",
    }),
  
  price: Joi.number()
    .positive()
    .optional()
    .messages({
      "number.positive": "Price must be positive",
    }),
  
  paymentMode: Joi.string()
    .valid("cash", "gpay", "card")
    .optional()
    .messages({
      "any.only": "Invalid payment mode",
    }),
  
  trainingType: Joi.string()
    .valid("Weight Loss", "Weight Gain", "Transformation")
    .optional()
    .messages({
      "any.only": "Invalid training type",
    }),
  
  extraDays: Joi.number()
    .integer()
    .min(0)
    .optional()
    .messages({
      "number.min": "Extra days cannot be negative",
    }),
  
  dietId: Joi.string()
    .hex()
    .length(24)
    .optional()
    .messages({
      "string.hex": "Invalid diet ID",
    }),
  
  dietName: Joi.string().optional(),
  
  dietIncludedInLastBilling: Joi.alternatives()
    .try(Joi.boolean(), Joi.string())
    .optional(),
}).or("plan", "newPlan");

export const validateMemberRegister = (data) => memberRegisterSchema.validate(data, { abortEarly: false });
export const validateMemberUpdate = (data) => memberUpdateSchema.validate(data, { abortEarly: false });
export const validateMemberSearch = (data) => memberSearchSchema.validate(data, { abortEarly: false });
export const validateMemberStatus = (data) => memberStatusSchema.validate(data, { abortEarly: false });
export const validateMemberRenew = (data) => memberRenewSchema.validate(data, { abortEarly: false });
