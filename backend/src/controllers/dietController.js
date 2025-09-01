// controllers/dietController.js - Diet management
import Diet from "../models/Diet.js";
import { asyncHandler, ValidationError, NotFoundError } from "../core/errorHandler.js";

export const dietController = {
  // Get all diets
  getAllDiets: asyncHandler(async (req, res) => {
    const { page = 1, pageSize = 10 } = req.query;
    const skip = (page - 1) * pageSize;

    const diets = await Diet.find({}).skip(skip).limit(Number(pageSize)).sort({ createdAt: -1 });
    const total = await Diet.countDocuments();

    return res.json({
      success: true,
      data: diets,
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  }),

  // Get diet by ID
  getDietById: asyncHandler(async (req, res) => {
    const diet = await Diet.findById(req.params.id);

    if (!diet) {
      throw new NotFoundError("Diet not found");
    }

    return res.json({
      success: true,
      data: diet,
    });
  }),

  // Create diet
  createDiet: asyncHandler(async (req, res) => {
    const { name, description } = req.body;

    if (!name) {
      throw new ValidationError("Missing required field: name");
    }

    const diet = new Diet({
      name,
      description: description || "",
    });

    await diet.save();

    return res.status(201).json({
      success: true,
      data: diet,
    });
  }),

  // Update diet
  updateDiet: asyncHandler(async (req, res) => {
    const diet = await Diet.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!diet) {
      throw new NotFoundError("Diet not found");
    }

    return res.json({
      success: true,
      data: diet,
    });
  }),

  // Delete diet
  deleteDiet: asyncHandler(async (req, res) => {
    const diet = await Diet.findByIdAndDelete(req.params.id);

    if (!diet) {
      throw new NotFoundError("Diet not found");
    }

    return res.json({
      success: true,
      message: "Diet deleted successfully",
    });
  }),
};

export default dietController;
