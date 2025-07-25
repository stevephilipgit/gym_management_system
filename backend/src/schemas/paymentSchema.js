// schemas/paymentSchema.js - Payment validation schemas
import Joi from "joi";

export const recordPaymentSchema = Joi.object({
  gymId: Joi.number().positive().required(),
  name: Joi.string().min(3).max(100).required(),
  plan: Joi.string().valid("1 Month", "3 Months", "6 Months", "1 Year", "12 Months").required(),
  trainingType: Joi.string().valid("Weight Loss", "Weight Gain", "Transformation").required(),
  amount: Joi.number().positive().required(),
  paymentMode: Joi.string().valid("cash", "gpay", "card", "bank_transfer", "upi", "online").required(),
  dietId: Joi.string().hex().length(24).optional(),
  dietName: Joi.string().optional(),
});

export const refundPaymentSchema = Joi.object({
  paymentId: Joi.string().hex().length(24).required(),
  refundAmount: Joi.number().positive().required(),
  reason: Joi.string().max(500).optional(),
});

export const validateRecordPayment = (data) => recordPaymentSchema.validate(data, { abortEarly: false });
export const validateRefundPayment = (data) => refundPaymentSchema.validate(data, { abortEarly: false });
