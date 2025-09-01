// controllers/fieldController.js - Dynamic fields management
import DynamicField from "../models/DynamicField.js";
import { asyncHandler, ValidationError, NotFoundError } from "../core/errorHandler.js";

export const fieldController = {
  // Get all dynamic fields
  getAllFields: asyncHandler(async (req, res) => {
    const fields = await DynamicField.find({}).sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: fields,
      count: fields.length,
    });
  }),

  // Get field by ID
  getFieldById: asyncHandler(async (req, res) => {
    const field = await DynamicField.findById(req.params.id);

    if (!field) {
      throw new NotFoundError("Field not found");
    }

    return res.json({
      success: true,
      data: field,
    });
  }),

  // Create new field
  createField: asyncHandler(async (req, res) => {
    const { label, type, required, options } = req.body;

    if (!label || !type) {
      throw new ValidationError("Missing required fields: label, type");
    }

    const normalizedLabel = String(label).trim();
    const key = normalizedLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const normalizedOptions = Array.isArray(options)
      ? options
      : typeof options === "string"
      ? options.split(",").map((v) => v.trim()).filter(Boolean)
      : [];

    const field = new DynamicField({
      key,
      label: normalizedLabel,
      type,
      required: required || false,
      options: type === "dropdown" ? normalizedOptions : [],
    });

    await field.save();

    return res.status(201).json({
      success: true,
      data: field,
    });
  }),

  // Update field
  updateField: asyncHandler(async (req, res) => {
    const updates = { ...req.body };

    if (updates.label) {
      const normalizedLabel = String(updates.label).trim();
      updates.label = normalizedLabel;
      updates.key = normalizedLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    }

    if (typeof updates.options === "string") {
      updates.options = updates.options.split(",").map((v) => v.trim()).filter(Boolean);
    }

    const field = await DynamicField.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!field) {
      throw new NotFoundError("Field not found");
    }

    return res.json({
      success: true,
      data: field,
    });
  }),

  // Delete field
  deleteField: asyncHandler(async (req, res) => {
    const field = await DynamicField.findByIdAndDelete(req.params.id);

    if (!field) {
      throw new NotFoundError("Field not found");
    }

    return res.json({
      success: true,
      message: "Field deleted successfully",
    });
  }),

  // Toggle field status
  toggleField: asyncHandler(async (req, res) => {
    const field = await DynamicField.findById(req.params.id);

    if (!field) {
      throw new NotFoundError("Field not found");
    }

    field.isEnabled = !field.isEnabled;
    await field.save();

    return res.json({
      success: true,
      data: field,
    });
  }),
};

export default fieldController;
