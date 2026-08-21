// controllers/packageController.js - Package management (gender-scoped)
import packageRepository from "../repositories/packageRepository.js";
import scopeResolver from "../core/scopeResolver.js";
import { asyncHandler, ValidationError, NotFoundError } from "../core/errorHandler.js";

// Genders a trainer may see / be assigned:
//   male: All + Male
//   female_plus_transgender: All + Female + Transgender
//   all (superadmin): everything
const allowedPackageGenders = (req) => {
  const allowed = scopeResolver.getScopeAllowedGenders(req);
  if (allowed.length === 0 || allowed.length >= 3) {
    return ["All", "Male", "Female", "Transgender"];
  }
  return ["All", ...allowed];
};

export const packageController = {
  // Get all packages
  // - Superadmin (scope all): sees every package; may narrow with ?gender=
  // - Trainer: only "All" + their gender-scoped packages (server-enforced)
  // - Public (no req.admin): sees every package (marketing)
  getAllPackages: asyncHandler(async (req, res) => {
    const allowed = allowedPackageGenders(req);
    const filter = { gender: { $in: allowed } };

    // Superadmin-only narrowing filter (never widens a trainer scope).
    const { gender } = req.query;
    if (gender && allowed.includes(gender)) {
      filter.gender = gender;
    }

    const packages = await packageRepository.findAll(filter, { sort: { createdAt: -1 } });

    return res.json({
      success: true,
      data: packages,
      count: packages.length,
    });
  }),

  // Get packages with pagination
  getPackagesPaginated: asyncHandler(async (req, res) => {
    const { page = 1, pageSize = 10, trainingType, gender } = req.query;
    const filters = {};

    if (trainingType) filters.trainingType = trainingType;
    filters.gender = { $in: allowedPackageGenders(req) };
    if (gender && allowedPackageGenders(req).includes(gender)) {
      filters.gender = gender;
    }

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

    // Scope check: never return a package outside the trainer's scope.
    if (!allowedPackageGenders(req).includes(pkg.gender || "All")) {
      throw new NotFoundError("Package not found");
    }

    return res.json({
      success: true,
      data: pkg,
    });
  }),

  // Create package (superadmin only via route)
  createPackage: asyncHandler(async (req, res) => {
    const {
      name,
      months,
      priceWeightLoss,
      priceWeightGain,
      priceTransformation,
      gender,
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
      gender: gender || "All",
    });

    return res.status(201).json({
      success: true,
      data: pkg,
    });
  }),

  // Update package (superadmin only via route)
  updatePackage: asyncHandler(async (req, res) => {
    const updates = { ...req.body };
    if (updates.gender !== undefined && !["All", "Male", "Female", "Transgender"].includes(updates.gender)) {
      throw new ValidationError("Invalid gender. Must be All, Male, Female, or Transgender");
    }

    const pkg = await packageRepository.update(req.params.id, updates);

    if (!pkg) {
      throw new NotFoundError("Package not found");
    }

    return res.json({
      success: true,
      data: pkg,
    });
  }),

  // Delete package (superadmin only via route)
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
