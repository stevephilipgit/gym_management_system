// schemas/mediaSchema.js - Validation for the photo media endpoints
import Joi from "joi";

// POST /api/media/presign
//   memberId omitted  -> registration flow, an in-flight "pending" key is issued
//   memberId present  -> key scoped to that member (authorization re-checked
//                        in the controller against branch + gender scope)
export const mediaPresignSchema = Joi.object({
  memberId: Joi.string()
    .hex()
    .length(24)
    .optional()
    .messages({
      "string.hex": "Invalid member ID",
      "string.length": "Invalid member ID",
    }),

  // The client already processed the image, so it knows the container type.
  extension: Joi.string()
    .valid("webp", "jpeg", "jpg")
    .optional()
    .default("webp")
    .messages({
      "any.only": "Only WebP or JPEG images are supported",
    }),
}).unknown(true);

export const validateMediaPresign = (data) =>
  mediaPresignSchema.validate(data, { abortEarly: false, stripUnknown: true });
