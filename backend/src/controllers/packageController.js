// controllers/packageController.js - Package management
import packageRepository from "../repositories/packageRepository.js";
import { asyncHandler, ValidationError, NotFoundError } from "../core/errorHandler.js";

export const packageController = {
  // Get all packages
  getAllPackages: asyncHandler(async (req, res) => {
    const packages = await packageRepository.getAllPackages();

    return res.json({
      success: true,
      data: packages,
      count: packages.length,
    });
  }),

  // Get packages with pagination
  getPackagesPaginated: asyncHandler(async (req, res) => {
    const { page = 1, pageSize = 10, trainingType } = req.query;
    const filters = {};

    if (trainingType) filters.trainingType = trainingType;

    const result = await packageRepository.getPaginated(Number(page), Number(pageSize), filters);

    return res.json({
      success: true,
      ...result,
    });
  }),

  // Get package by ID
  getPackageById: asyncHandler(async (req, res) => {
    const pkg = await packageRepository.findById(req.params.id);

    if (!pkg) {
      throw new NotFoundError("Package not found");
    }

    return res.json({
      success: true,
      data: pkg,
    });
  }),

  // Create package
  createPackage: asyncHandler(async (req, res) => {
    const {
      name,
      months,
      priceWeightLoss,
      priceWeightGain,
      priceTransformation,
    } = req.body;

    if (
      !name ||
      !months ||
      priceWeightLoss === undefined ||
      priceWeightGain === undefined ||
      priceTransformation === undefined
    ) {
      throw new ValidationError(
        "Missing required fields: name, months, priceWeightLoss, priceWeightGain, priceTransformation"
      );
    }

    const pkg = await packageRepository.create({
      name,
      months: Number(months),
      priceWeightLoss: Number(priceWeightLoss),
      priceWeightGain: Number(priceWeightGain),
      priceTransformation: Number(priceTransformation),
    });

    return res.status(201).json({
      success: true,
      data: pkg,
    });
  }),

  // Update package
  updatePackage: asyncHandler(async (req, res) => {
    const pkg = await packageRepository.update(req.params.id, req.body);

    if (!pkg) {
      throw new NotFoundError("Package not found");
    }

    return res.json({
      success: true,
      data: pkg,
    });
  }),

  // Delete package
  deletePackage: asyncHandler(async (req, res) => {
    const pkg = await packageRepository.delete(req.params.id);

    if (!pkg) {
      throw new NotFoundError("Package not found");
    }

    return res.json({
      success: true,
      message: "Package deleted successfully",
    });
  }),

  // Get packages by training type
  getByTrainingType: asyncHandler(async (req, res) => {
    const { trainingType } = req.params;

    const packages = await packageRepository.findByTrainingType(trainingType);

    return res.json({
      success: true,
      data: packages,
      count: packages.length,
    });
  }),
};

export default packageController;
