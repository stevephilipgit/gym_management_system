// repositories/memberRepository.js - Data access layer for members
import Member from "../models/Member.js";

class MemberRepository {
  normalizeGymId(gymId) {
    const digitsOnly = String(gymId ?? "").replace(/\D/g, "");
    if (!digitsOnly) return null;
    const parsed = Number(digitsOnly);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Find by ID
  async findById(id) {
    return Member.findById(id).populate("dietId");
  }

  // Find by Gym ID
  async findByGymId(gymId) {
    const parsedGymId = this.normalizeGymId(gymId);
    if (!parsedGymId) return null;
    return Member.findOne({ gymId: parsedGymId }).populate("dietId");
  }

  // Find by phone
  async findByPhone(phone) {
    const normalizedPhone = String(phone ?? "").replace(/\D/g, "");
    if (!normalizedPhone) return null;
    return Member.findOne({ phone: normalizedPhone }).populate("dietId");
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

  // Update by Gym ID
  async updateByGymId(gymId, updateData) {
    const parsedGymId = this.normalizeGymId(gymId);
    if (!parsedGymId) return null;
    return Member.findOneAndUpdate({ gymId: parsedGymId }, updateData, {
      new: true,
      runValidators: true,
    }).populate("dietId");
  }

  // Delete member
  async delete(id) {
    return Member.findByIdAndDelete(id);
  }

  // Delete by Gym ID
  async deleteByGymId(gymId) {
    const parsedGymId = this.normalizeGymId(gymId);
    if (!parsedGymId) return null;
    return Member.findOneAndDelete({ gymId: parsedGymId });
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

    return Member.find(query).sort({ validityEnd: 1 });
  }

  // Find expired members
  async findExpiredMembers() {
    const now = new Date();
    return Member.find({
      validityEnd: { $lt: now },
      status: { $ne: "archived" },
    });
  }

  // Find members by status
  async findByStatus(status) {
    return Member.find({ status }).populate("dietId");
  }

  // Find members by package
  async findByPackage(gymPlan) {
    return Member.find({ gymPlan }).populate("dietId");
  }

  // Search members (by name, phone, aadhar, gymId)
  async search(searchTerm) {
    return Member.find({
      $or: [
        { fullName: { $regex: searchTerm, $options: "i" } },
        { phone: { $regex: searchTerm, $options: "i" } },
        { aadhar: { $regex: searchTerm, $options: "i" } },
        { gymId: Number(searchTerm) || null },
      ],
    }).populate("dietId");
  }

  // Update member status
  async updateStatus(id, status) {
    return Member.findByIdAndUpdate(id, { status }, { new: true }).populate(
      "dietId"
    );
  }

  // Get members with pagination
  async getPaginated(page = 1, pageSize = 10, filters = {}) {
    const skip = (page - 1) * pageSize;
    const members = await this.findAll(filters, {
      skip,
      limit: pageSize,
      sort: { createdAt: -1 },
    });
    const total = await this.countAll(filters);

    return {
      data: members,
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    };
  }
}

export default new MemberRepository();
