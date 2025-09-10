// repositories/packageRepository.js - Data access layer for packages
import Package from "../models/Package.js";

class PackageRepository {
  // Find package by ID
  async findById(id) {
    return Package.findById(id);
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

  // Update package
  async update(id, updateData) {
    return Package.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });
  }

  // Delete package
  async delete(id) {
    return Package.findByIdAndDelete(id);
  }

  // Find package by name
  async findByName(name) {
    return Package.findOne({ name });
  }

  // Find packages by training type
  async findByTrainingType(trainingType) {
    return Package.find({ trainingType });
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
