// controllers/memberController.js - Business logic for member operations
import memberRepository from "../repositories/memberRepository.js";
import paymentRepository from "../repositories/paymentRepository.js";
import { updateTodaySummary } from "../services/summaryService.js";
import { auditActions } from "../utils/auditLog.js";
import { asyncHandler, ValidationError, NotFoundError, ForbiddenError, ConflictError } from "../core/errorHandler.js";
import PaymentLog from "../models/PaymentLog.js";
import FinanceLog from "../models/FinanceLog.js";
import Counter from "../services/atomicCounter.js";
import scopeResolver from "../core/scopeResolver.js";

const MS_DAY = 1000 * 60 * 60 * 24;

const getPlanMonths = (plan) =>
  ({
    "1 Month": 1,
    "3 Months": 3,
    "6 Months": 6,
    "1 Year": 12,
    "12 Months": 12,
  }[plan] || 0);

const calculateDaysLeft = (date) => {
  if (!date) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const valid = new Date(date);
  if (Number.isNaN(valid.getTime())) return 0;
  valid.setHours(0, 0, 0, 0);
  const diffTime = valid.getTime() - today.getTime();
  return Math.ceil(diffTime / MS_DAY);
};

const getNextGymId = async () => {
  const last = await memberRepository.findAll({}, { limit: 1, sort: { gymId: -1 } });
  return last[0] ? last[0].gymId + 1 : 1001;
};

export const memberController = {
  // Register a new member
  registerMember: asyncHandler(async (req, res) => {
    const data = req.body;
    const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;

    // Validate required fields
    if (!data.fullName || !data.fatherName || !data.phone) {
      throw new ValidationError("Missing required fields: fullName, fatherName, phone");
    }

    // Parse custom fields
    const customFields = data.customFields ? JSON.parse(data.customFields) : {};
    delete data.customFields;

    // Verify requested gender against admin scope (centralized rule)
    if (data.gender) {
      const allowedGenders = scopeResolver.getScopeAllowedGenders(req);
      if (allowedGenders.length > 0 && !allowedGenders.includes(data.gender)) {
        throw new ForbiddenError(
          `Access denied: cannot register ${data.gender} member with current admin scope`
        );
      }
    }

    const paymentStatus = data.paymentStatus === "paid" ? "paid" : "not_paid";
    let paymentMode = null;

    if (paymentStatus === "paid") {
      const mode = data.paymentMode?.toLowerCase();
      if (!["cash", "gpay", "card"].includes(mode)) {
        throw new ValidationError("Invalid payment mode");
      }
      paymentMode = mode;
    }

    // Generate next Gym ID
    const gymId = await getNextGymId();

    // Generate atomic member code
    const codePrefix = {
      Male: "M",
      Female: "F",
      Transgender: "T",
    }[data.gender] || "M";
    const counter = await Counter.increment(`member_code_${codePrefix}`);
    const memberCode = `${codePrefix}${counter
      .toString()
      .padStart(4, "0")
      .slice(-4)}`;

    // Calculate validity dates
    let currentPaymentDate = null;
    let validityEnd = null;

    if (paymentStatus === "paid") {
      currentPaymentDate = new Date();
      validityEnd = new Date(currentPaymentDate);
      validityEnd.setMonth(validityEnd.getMonth() + getPlanMonths(data.gymPlan));
      validityEnd.setDate(validityEnd.getDate() - 1);
    }

    // Create member
    const member = await memberRepository.create({
      gymId,
      memberCode,
      ...data,
      aadhar: String(data.aadhar).replace(/\D/g, ""),
      phone: String(data.phone).replace(/\D/g, ""),
      paymentStatus,
      paymentMode,
      currentPaymentDate,
      validityEnd,
      customFields,
      photoUrl,
      status: paymentStatus === "paid" ? "active" : "draft",
    });

    // Create finance and payment logs if paid
    if (paymentStatus === "paid") {
      const financeLog = await FinanceLog.create({
        gymId,
        memberName: member.fullName,
        amount: Number(data.amount) || 0,
        plan: data.gymPlan,
        trainingType: data.trainingType,
        type: "new",
        date: new Date(),
      });

      await PaymentLog.create({
        gymId,
        name: member.fullName,
        amount: Number(data.amount) || 0,
        plan: data.gymPlan,
        trainingType: data.trainingType,
        paidAt: new Date(),
        paymentMode: paymentMode,
        type: "new",
        dietId: data.dietId || null,
        dietName: data.dietName || null,
      });

      // Update daily summary
      await updateTodaySummary(financeLog);
    }

    // Audit log
    await auditActions.memberCreated(req, member._id, {
      gymId: member.gymId,
      fullName: member.fullName,
      phone: member.phone,
      plan: data.gymPlan,
    });

    return res.status(201).json({ success: true, data: member, member });
  }),

  // Get all members
  getAllMembers: asyncHandler(async (req, res) => {
    const { page = 1, pageSize = 10, status, search, gender } = req.query;
    const filters = {};

    // Gender-scope enforcement (centralized via scopeResolver).
    const genderFilter = scopeResolver.buildGenderFilter(req);
    if (genderFilter.gender) {
      filters.gender = genderFilter.gender;
    }

    // Superadmin-only narrowing filter: a valid ?gender= query narrows the
    // "all" scope. It can never widen a trainer's scope (trainers fall into
    // the else branch above and the param is ignored).
    if (gender && req.admin?.scope === "all" && ["Male", "Female", "Transgender"].includes(gender)) {
      filters.gender = gender;
    }

    if (status) filters.status = status;
    if (search) {
      // The search path MUST keep the same gender scope as the list path —
      // otherwise a trainer could list all genders by adding ?search=.
      const members = await memberRepository.search(search, filters);
      return res.json({
        success: true,
        data: members,
      });
    }

    const result = await memberRepository.getPaginated(
      Number(page),
      Number(pageSize),
      filters
    );

    return res.json({
      success: true,
      ...result,
    });
  }),

  // Get member by ID
  getMemberById: asyncHandler(async (req, res) => {
    const lookupGymId = req.params.gymId || req.params.id;
    const member = await memberRepository.findByGymId(lookupGymId);

    if (!member) {
      throw new NotFoundError("Member not found");
    }

    // Verify admin scope against member gender
    if (!scopeResolver.checkMemberScope(req, member.gender)) {
      throw new ForbiddenError("Access denied: insufficient scope for this member");
    }

    // Calculate days left
    const daysLeft = calculateDaysLeft(member.validityEnd);

    return res.json({
      success: true,
      data: {
        ...member.toObject(),
        daysLeft,
      },
    });
  }),

  // Get member by Gym ID
  getMemberByGymId: asyncHandler(async (req, res) => {
    const member = await memberRepository.findByGymId(req.params.gymId);

    if (!member) {
      throw new NotFoundError("Member not found");
    }

    // Verify admin scope against member gender
    if (!scopeResolver.checkMemberScope(req, member.gender)) {
      throw new ForbiddenError("Access denied: insufficient scope for this member");
    }

    const daysLeft = calculateDaysLeft(member.validityEnd);

    return res.json({
      success: true,
      data: {
        ...member.toObject(),
        daysLeft,
      },
    });
  }),

  // Update member
  updateMember: asyncHandler(async (req, res) => {
    const lookupGymId = req.params.gymId || req.params.id;

    // Load member first and verify scope BEFORE mutation
    const existingMember = await memberRepository.findByGymId(lookupGymId);
    if (!existingMember) {
      throw new NotFoundError("Member not found");
    }

    // Verify admin scope against existing member gender
    if (!scopeResolver.checkMemberScope(req, existingMember.gender)) {
      throw new ForbiddenError("Access denied: insufficient scope for this member");
    }

    const data = req.body;

    // Optimistic concurrency: require the version the trainer loaded.
    const expectedVersion = Number(data.version);
    delete data.version; // never write version via the update payload
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new ValidationError("version is required for update. Please reload the member and try again.");
    }

    // Handle photo upload
    if (req.file) {
      data.photoUrl = `/uploads/${req.file.filename}`;
    }

    // Parse custom fields if provided
    if (data.customFields && typeof data.customFields === "string") {
      data.customFields = JSON.parse(data.customFields);
    }

    // Do NOT trust incoming gender to authorize the operation.
    // Scope is verified against the existing member gender above.

    const member = await memberRepository.updateByGymId(lookupGymId, data, expectedVersion);

    if (!member) {
      // Distinguish "member deleted" (404) from "another admin edited it" (409)
      const stillExists = await memberRepository.findByGymId(lookupGymId);
      if (stillExists) {
        throw new ConflictError(
          "This member was modified by another user. Please reload the member and try again."
        );
      }
      throw new NotFoundError("Member not found");
    }

    return res.json({ success: true, data: member });
  }),

  // Delete member
  deleteMember: asyncHandler(async (req, res) => {
    const lookupGymId = req.params.gymId || req.params.id;

    // Load member first and verify scope
    const existingMember = await memberRepository.findByGymId(lookupGymId);
    if (!existingMember) {
      throw new NotFoundError("Member not found");
    }

    // Verify admin scope - only superadmin (scope=all) can delete
    if (!scopeResolver.checkMemberScope(req, existingMember.gender)) {
      throw new ForbiddenError("Access denied: only superadmin can delete members");
    }

    const member = await memberRepository.deleteByGymId(lookupGymId);

    if (!member) {
      throw new NotFoundError("Member not found");
    }

    // Audit log
    await auditActions.memberDeleted(req, member._id);

    return res.json({ success: true, message: "Member deleted successfully" });
  }),

  // Get expiring members
  getExpiringMembers: asyncHandler(async (req, res) => {
    const {
      days = 3650,
      includeExpired = "true",
      includeDraft = "true",
      includeAllStatuses = "false",
      gender,
    } = req.query;

    // Gender-scope enforcement (centralized via scopeResolver)
    const genderFilter = scopeResolver.buildGenderFilter(req);

    // Superadmin-only narrowing filter (?gender= on the Due page).
    if (gender && req.admin?.scope === "all" && ["Male", "Female", "Transgender"].includes(gender)) {
      genderFilter.gender = gender;
    }

    const members = await memberRepository.findExpiringMembers(Number(days), {
      includeExpired: includeExpired === "true",
      includeDraft: includeDraft === "true",
      includeAllStatuses: includeAllStatuses === "true",
      ...genderFilter,
    });

    return res.json({
      success: true,
      data: members,
      message: `Members due within ${days} days`,
    });
  }),

  // Get expired members
  getExpiredMembers: asyncHandler(async (req, res) => {
    // Gender-scope enforcement (centralized via scopeResolver)
    const genderFilter = scopeResolver.buildGenderFilter(req);

    const members = await memberRepository.findExpiredMembers(genderFilter);

    return res.json({
      success: true,
      data: members,
      message: "Expired members",
    });
  }),

  // Public validity check
  checkPublicValidity: asyncHandler(async (req, res) => {
    const gymIdFromParam = req.params.gymId;
    const gymIdFromQuery = req.query.gymId;
    const phoneFromQuery = req.query.phone;

    const gymId = gymIdFromParam || gymIdFromQuery;
    let member = null;

    if (phoneFromQuery) {
      const cleanPhone = String(phoneFromQuery).replace(/\D/g, "");
      if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
        throw new ValidationError("Invalid phone format");
      }
      member = await memberRepository.findByPhone(cleanPhone);
    } else if (gymId) {
      const cleanGymId = String(gymId).replace(/\D/g, "");
      if (!/^\d{4,6}$/.test(cleanGymId)) {
        throw new ValidationError("Invalid Gym ID format");
      }
      member = await memberRepository.findByGymId(cleanGymId);
    } else {
      throw new ValidationError("Provide gymId or phone");
    }

    if (!member) {
      return res.json({
        success: true,
        data: {
          found: false,
          message: "No membership found",
        },
      });
    }

    const daysLeft = calculateDaysLeft(member.validityEnd);
    const validityEndDate = member.validityEnd
      ? new Date(member.validityEnd).toLocaleDateString("en-GB")
      : "-";

    return res.json({
      success: true,
      data: {
        found: true,
        gymId: member.gymId,
        name: member.fullName,
        phone: member.phone || "-",
        plan: member.gymPlan || "-",
        validityEndDate,
        daysLeft,
        status: member.status || "unknown",
        lastVisit: member.lastAttendanceDate || "-",
      },
    });
  }),

  // Update member status
  updateMemberStatus: asyncHandler(async (req, res) => {
    const { status } = req.body;

    if (!["active", "inactive", "suspended", "expired", "archived"].includes(status)) {
      throw new ValidationError("Invalid status value");
    }

    const member = await memberRepository.updateStatus(req.params.id, status);

    if (!member) {
      throw new NotFoundError("Member not found");
    }

    return res.json({ success: true, data: member });
  }),

  // Renew member
  renewMember: asyncHandler(async (req, res) => {
    const lookupGymId = req.params.gymId || req.params.id;

    // Load member first and verify scope BEFORE mutation
    const existingMember = await memberRepository.findByGymId(lookupGymId);
    if (!existingMember) {
      throw new NotFoundError("Member not found");
    }

    // Verify admin scope against member gender
    if (!scopeResolver.checkMemberScope(req, existingMember.gender)) {
      throw new ForbiddenError("Access denied: insufficient scope for this member renewal");
    }

    const {
      plan,
      newPlan,
      amount,
      price,
      paymentMode,
      trainingType,
      extraDays = 0,
      dietId,
      dietName,
      dietIncludedInLastBilling,
    } = req.body;

    const selectedPlan = newPlan || plan;
    const selectedAmount = Number(price ?? amount ?? 0);
    const parsedExtraDays = Number(extraDays) || 0;
    const selectedPaymentMode = paymentMode || "cash";

    // Optimistic concurrency: renewal must be based on the version the
    // trainer loaded, otherwise a concurrent renewal is silently lost.
    const expectedVersion = Number(req.body.version);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new ValidationError("version is required for renewal. Please reload the member and try again.");
    }

    // Calculate new validity
    const baseDate = existingMember.validityEnd ? new Date(existingMember.validityEnd) : new Date();
    const newValidityEnd = new Date(baseDate);
    newValidityEnd.setMonth(newValidityEnd.getMonth() + getPlanMonths(selectedPlan));
    newValidityEnd.setDate(newValidityEnd.getDate() - 1);
    if (parsedExtraDays) {
      newValidityEnd.setDate(newValidityEnd.getDate() + parsedExtraDays);
    }

    // Update member
    const updatedMember = await memberRepository.updateByGymId(lookupGymId, {
      oldPaymentDate: existingMember.currentPaymentDate,
      currentPaymentDate: new Date(),
      validityEnd: newValidityEnd,
      paymentStatus: "paid",
      paymentMode: selectedPaymentMode,
      status: "active",
      gymPlan: selectedPlan,
      trainingType: trainingType || existingMember.trainingType,
      dietId: dietId || existingMember.dietId || null,
      dietName: dietName || existingMember.dietName || null,
      dietIncludedInLastBilling: dietIncludedInLastBilling === "true" || Boolean(dietIncludedInLastBilling),
    }, expectedVersion);

    if (!updatedMember) {
      // Distinguish "member deleted" (404) from "another admin edited it" (409)
      const stillExists = await memberRepository.findByGymId(lookupGymId);
      if (stillExists) {
        throw new ConflictError(
          "This member was modified by another user. Please reload the member and try again."
        );
      }
      throw new NotFoundError("Member not found");
    }

    // Log payment and finance
    const financeLog = await FinanceLog.create({
      gymId: updatedMember.gymId,
      memberName: updatedMember.fullName,
      amount: selectedAmount,
      plan: selectedPlan,
      trainingType: trainingType || existingMember.trainingType,
      type: "renew",
      date: new Date(),
    });

    await PaymentLog.create({
      gymId: updatedMember.gymId,
      name: updatedMember.fullName,
      amount: selectedAmount,
      plan: selectedPlan,
      trainingType: trainingType || existingMember.trainingType,
      paidAt: new Date(),
      paymentMode: selectedPaymentMode,
      type: "renewal",
      dietId: dietId || null,
      dietName: dietName || null,
    });

    // Update daily summary
    await updateTodaySummary(financeLog);

    return res.json({ success: true, data: updatedMember });
  }),

  // Search members
  searchMembers: asyncHandler(async (req, res) => {
    const { q } = req.query;

    if (!q || q.length < 2) {
      throw new ValidationError("Search query must be at least 2 characters");
    }

    // Gender-scope enforcement (centralized via scopeResolver)
    const genderFilter = scopeResolver.buildGenderFilter(req);

    const members = await memberRepository.search(q, genderFilter);

    return res.json({
      success: true,
      data: members,
      count: members.length,
    });
  }),
};

export default memberController;
