// repositories/packageRepository.js - Data access layer for packages
import Package from "../models/Package.js";

class PackageRepository {
  // Find package by ID — scoped to one branch when branchId is given
  // (cross-branch ids read as "not found", same as a bad id).
  async findById(id, branchId = null) {
    const filter = { _id: id };
    if (branchId) filter.branchId = branchId;
    return Package.findOne(filter);
  }

  // Find all packages
  async findAll(filters = {}, options = {}) {
    const { skip = 0, limit = 100, sort = { createdAt: -1 } } = options;
    const query = Package.find(filters);

    if (sort) query.sort(sort);
    if (skip) query.skip(skip);
    if (limit) query.limit(limit);

    return query;
  }

  // Get all packages (simple list)
  async getAllPackages() {
    return Package.find({}).sort({ createdAt: -1 });
  }

  // Count packages
  async count(filters = {}) {
    return Package.countDocuments(filters);
  }

  // Create package
  async create(packageData) {
    const pkg = new Package(packageData);
    return pkg.save();
  }

  // Update package — branch-scoped when branchId is given
  async update(id, updateData, branchId = null) {
    const filter = { _id: id };
    if (branchId) filter.branchId = branchId;
    return Package.findOneAndUpdate(filter, updateData, {
      new: true,
      runValidators: true,
    });
  }

  // Delete package — branch-scoped when branchId is given
  async delete(id, branchId = null) {
    const filter = { _id: id };
    if (branchId) filter.branchId = branchId;
    return Package.findOneAndDelete(filter);
  }

  // Find package by name (within a branch when branchId is given)
  async findByName(name, branchId = null) {
    const filter = { name };
    if (branchId) filter.branchId = branchId;
    return Package.findOne(filter);
  }

  // Find packages by training type (within a branch when branchId is given)
  async findByTrainingType(trainingType, branchId = null) {
    const filter = { trainingType };
    if (branchId) filter.branchId = branchId;
    return Package.find(filter);
  }

  // Get paginated packages
  async getPaginated(page = 1, pageSize = 10, filters = {}) {
    const skip = (page - 1) * pageSize;
    const packages = await this.findAll(filters, {
      skip,
      limit: pageSize,
      sort: { createdAt: -1 },
    });
    const total = await this.count(filters);

    return {
      data: packages,
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    };
  }
}

export default new PackageRepository();
