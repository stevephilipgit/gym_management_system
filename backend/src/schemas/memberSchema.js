// schemas/memberSchema.js - Member validation schemas
import Joi from "joi";

export const memberRegisterSchema = Joi.object({
  fullName: Joi.string().min(3).max(100).required(),
  fatherName: Joi.string().min(2).max(100).required(),
  phone: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .required(),
  email: Joi.string().email().optional(),
  dob: Joi.date().required(),
  bloodGroup: Joi.string().valid("A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-").required(),
  gender: Joi.string().valid("Male", "Female").required(),
  aadhar: Joi.string().pattern(/^\d{12}$/).required(),
  occupation: Joi.string().max(100).required(),
  address: Joi.string().max(500).required(),
  medicalIssues: Joi.string().optional(),
  gymPlan: Joi.string().max(50).required(),
  trainingType: Joi.string().valid("Weight Loss", "Weight Gain", "Transformation").required(),
  paymentStatus: Joi.string().valid("paid", "not_paid").optional(),
  paymentMode: Joi.string().valid("cash", "gpay", "card").optional(),
  amount: Joi.number().positive().optional(),
  dietId: Joi.string().hex().length(24).optional(),
  customFields: Joi.alternatives().try(Joi.object(), Joi.string()).optional(),
}).unknown(true);

export const memberUpdateSchema = Joi.object({
  fullName: Joi.string().min(3).max(100).optional(),
  fatherName: Joi.string().min(2).max(100).optional(),
  dob: Joi.date().optional(),
  occupation: Joi.string().max(100).optional(),
  gender: Joi.string().valid("Male", "Female").optional(),
  trainingType: Joi.string().valid("Weight Loss", "Weight Gain", "Transformation").optional(),
  gymPlan: Joi.string().max(50).optional(),
  aadhar: Joi.string().pattern(/^\d{12}$/).optional(),
  phone: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .optional(),
  email: Joi.string().email().optional(),
  bloodGroup: Joi.string().valid("A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-").optional(),
  address: Joi.string().max(500).optional(),
  medicalIssues: Joi.string().optional(),
  status: Joi.string().valid("active", "inactive", "suspended", "expired", "archived").optional(),
  dietId: Joi.string().hex().length(24).optional(),
  customFields: Joi.alternatives().try(Joi.object(), Joi.string()).optional(),
}).unknown(true);

export const memberSearchSchema = Joi.object({
  q: Joi.string().min(2).max(100).required(),
});

export const memberStatusSchema = Joi.object({
  status: Joi.string().valid("active", "inactive", "suspended", "expired", "archived").required(),
});

export const memberRenewSchema = Joi.object({
  plan: Joi.string().max(50).optional(),
  newPlan: Joi.string().max(50).optional(),
  amount: Joi.number().positive().optional(),
  price: Joi.number().positive().optional(),
  paymentMode: Joi.string().valid("cash", "gpay", "card").optional(),
  trainingType: Joi.string().valid("Weight Loss", "Weight Gain", "Transformation").optional(),
  extraDays: Joi.number().integer().min(0).optional(),
  dietId: Joi.string().hex().length(24).optional(),
  dietName: Joi.string().optional(),
  dietIncludedInLastBilling: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
}).or("plan", "newPlan");

export const validateMemberRegister = (data) => memberRegisterSchema.validate(data, { abortEarly: false });
export const validateMemberUpdate = (data) => memberUpdateSchema.validate(data, { abortEarly: false });
export const validateMemberSearch = (data) => memberSearchSchema.validate(data, { abortEarly: false });
export const validateMemberStatus = (data) => memberStatusSchema.validate(data, { abortEarly: false });
export const validateMemberRenew = (data) => memberRenewSchema.validate(data, { abortEarly: false });
