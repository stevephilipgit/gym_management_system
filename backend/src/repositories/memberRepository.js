// repositories/memberRepository.js - Data access layer for members
import Member from "../models/Member.js";

export const MAX_PAGE_SIZE = 100;

// Pure helper — safe to import and test without a database.
export const clampPagination = (page, pageSize) => {
  const safePage = Number.isFinite(Number(page)) && Number(page) >= 1 ? Math.floor(Number(page)) : 1;
  const rawSize = Number.isFinite(Number(pageSize)) && Number(pageSize) >= 1 ? Math.floor(Number(pageSize)) : 10;
  const safeSize = Math.min(MAX_PAGE_SIZE, rawSize);
  return { page: safePage, pageSize: safeSize };
};

class MemberRepository {
  normalizeGymId(gymId) {
    const digitsOnly = String(gymId ?? "").replace(/\D/g, "");
    if (!digitsOnly) return null;
    const parsed = Number(digitsOnly);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Find by ID (ObjectId — always unique)
  async findById(id) {
    return Member.findById(id).populate("dietId");
  }

  // Find by Gym ID with optional scope + disambiguation.
  // opts = { allowedGenders, memberCode }
  //   memberCode · globally unique — exact match, ignores scope.
  //   allowedGenders · scoped lookup (trainer resolve).
  //   neither · backward-compatible unscoped lookup.
  async findByGymId(gymId, opts = {}) {
    const parsedGymId = this.normalizeGymId(gymId);
    if (!parsedGymId) return null;
    const filter = { gymId: parsedGymId };
    if (opts.memberCode) {
      filter.memberCode = opts.memberCode;
    } else if (opts.allowedGenders && opts.allowedGenders.length > 0) {
      filter.gender = { $in: opts.allowedGenders };
    }
    return Member.findOne(filter).populate("dietId");
  }

  // Find all members with a given gymId (for superadmin disambiguation).
  async findAllByGymId(gymId) {
    const parsed = this.normalizeGymId(gymId);
    if (!parsed) return [];
    return Member.find({ gymId: parsed }).populate("dietId").lean();
  }

  // Find by phone with optional scope
  async findByPhone(phone, allowedGenders = null) {
    const normalizedPhone = String(phone ?? "").replace(/\D/g, "");
    if (!normalizedPhone) return null;
    const filter = { phone: normalizedPhone };
    if (allowedGenders && allowedGenders.length > 0) {
      filter.gender = { $in: allowedGenders };
    }
    return Member.findOne(filter).populate("dietId");
  }

  // Find all members with filters
  async findAll(filters = {}, options = {}) {
    const { skip = 0, limit = 100, sort = { createdAt: -1 } } = options;
    const query = Member.find(filters);

    if (sort) query.sort(sort);
    if (skip) query.skip(skip);
    if (limit) query.limit(limit);

    return query.populate("dietId");
  }

  // Get total count with filters
  async countAll(filters = {}) {
    return Member.countDocuments(filters);
  }

  // Create member
  async create(memberData) {
    const member = new Member(memberData);
    return member.save();
  }

  // Update member
  async update(id, updateData) {
    return Member.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate("dietId");
  }

  // Update by Gym ID with optimistic concurrency and optional scope.
  // opts = { allowedGenders, memberCode }
  async updateByGymId(gymId, updateData, expectedVersion, opts = {}) {
    const parsedGymId = this.normalizeGymId(gymId);
    if (!parsedGymId) return null;

    const filter = { gymId: parsedGymId };
    if (opts.memberCode) {
      filter.memberCode = opts.memberCode;
    } else if (opts.allowedGenders && opts.allowedGenders.length > 0) {
      filter.gender = { $in: opts.allowedGenders };
    }
    if (typeof expectedVersion === "number" && Number.isInteger(expectedVersion)) {
      if (expectedVersion === 0) {
        filter.$or = [{ version: 0 }, { version: { $exists: false } }];
      } else {
        filter.version = expectedVersion;
      }
    }

    return Member.findOneAndUpdate(
      filter,
      { ...updateData, $inc: { version: 1 } },
      { new: true, runValidators: true }
    ).populate("dietId");
  }

  // Delete by Gym ID with optional scope
  async deleteByGymId(gymId, opts = {}) {
    const parsedGymId = this.normalizeGymId(gymId);
    if (!parsedGymId) return null;
    const filter = { gymId: parsedGymId };
    if (opts.memberCode) {
      filter.memberCode = opts.memberCode;
    } else if (opts.allowedGenders && opts.allowedGenders.length > 0) {
      filter.gender = { $in: opts.allowedGenders };
    }
    return Member.findOneAndDelete(filter);
  }

  // Find expiring members (validity ending within N days)
  async findExpiringMembers(days = 7, options = {}) {
    const now = new Date();
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const includeExpired = Boolean(options.includeExpired);
    const includeDraft = Boolean(options.includeDraft);
    const includeAllStatuses = Boolean(options.includeAllStatuses);

    const query = {
      validityEnd: includeExpired ? { $lte: futureDate } : { $gte: now, $lte: futureDate },
    };

    if (!includeAllStatuses) {
      query.status = includeDraft ? { $in: ["active", "expired", "draft"] } : { $in: ["active", "expired"] };
    }

    // Gender scope: prefer the explicit `genderFilter` key; fall back to a
    // top-level `gender` fragment (defensive for any future caller that spreads).
    const genderConstraint = options.genderFilter?.gender || options.gender;
    if (genderConstraint) {
      query.gender = genderConstraint;
    }

    return Member.find(query).sort({ validityEnd: 1 });
  }

  // Find expired members
  async findExpiredMembers(genderFilter = {}) {
    const now = new Date();
    const query = {
      validityEnd: { $lt: now },
      status: { $ne: "archived" },
    };
    if (genderFilter.gender) {
      query.gender = genderFilter.gender;
    }
    return Member.find(query).populate("dietId");
  }

  // Find members by status
  async findByStatus(status) {
    return Member.find({ status }).populate("dietId");
  }

  // Find members by package
  async findByPackage(gymPlan) {
    return Member.find({ gymPlan }).populate("dietId");
  }

  // Search members (by name, phone, aadhar, gymId) — scope-aware via genderFilter
  async search(searchTerm, genderFilter = {}) {
    return Member.find({
      $or: [
        { fullName: { $regex: searchTerm, $options: "i" } },
        { phone: { $regex: searchTerm, $options: "i" } },
        { aadhar: { $regex: searchTerm, $options: "i" } },
        { gymId: Number(searchTerm) || null },
      ],
      ...genderFilter,
    }).populate("dietId");
  }

  // Update member status
  async updateStatus(id, status) {
    return Member.findByIdAndUpdate(id, { status }, { new: true }).populate("dietId");
  }

  // Get members with pagination
  async getPaginated(page = 1, pageSize = 10, filters = {}) {
    const { page: safePage, pageSize: safePageSize } = clampPagination(page, pageSize);
    const skip = (safePage - 1) * safePageSize;
    const members = await this.findAll(filters, {
      skip,
      limit: safePageSize,
      sort: { createdAt: -1 },
    });
    const total = await this.countAll(filters);

    return {
      data: members,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total,
        pages: Math.ceil(total / safePageSize),
      },
    };
  }
}

export default new MemberRepository();