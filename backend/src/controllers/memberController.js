// controllers/memberController.js - Business logic for member operations
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import Member from "../models/Member.js";
import memberRepository from "../repositories/memberRepository.js";
import paymentRepository from "../repositories/paymentRepository.js";
import { updateTodaySummary } from "../services/summaryService.js";
import { auditActions } from "../utils/auditLog.js";
import { asyncHandler, ValidationError, NotFoundError, ForbiddenError, ConflictError } from "../core/errorHandler.js";
import PaymentLog from "../models/PaymentLog.js";
import FinanceLog from "../models/FinanceLog.js";
import Counter from "../services/atomicCounter.js";
import scopeResolver from "../core/scopeResolver.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MS_DAY = 1000 * 60 * 60 * 24;
const GENDER_PREFIX = { Male: "M", Female: "F", Transgender: "F" };

// Sort mapping for the member list. "daysLeft" is a derived value (validityEnd
// minus today), so it maps to validityEnd for server-side sorting. Unknown or
// missing keys fall back to newest-first (createdAt desc).
const MEMBER_SORT_FIELDS = {
  daysLeft: "validityEnd",
  validTill: "validityEnd",
  validityEnd: "validityEnd",
  createdAt: "createdAt",
  name: "fullName",
  gymId: "gymId",
  phone: "phone",
};
const buildMemberSort = (sortBy, sortOrder) => {
  const field = MEMBER_SORT_FIELDS[sortBy];
  if (!field) return { createdAt: -1 };
  const order = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;
  return { [field]: order };
};

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

// Per-gender atomic gymId generation. The counter is seeded from the current
// max for that gender on first use then monotonically incremented.
// Existing members' gymId values are never changed.
const getNextGymId = async (gender) => {
  const prefix = GENDER_PREFIX[gender] || "M";
  const key = `gym_id_${prefix}`;
  const maxDoc = await Member.findOne({ gender }).sort({ gymId: -1 }).select("gymId").lean();
  const floor = Math.max(1000, maxDoc?.gymId || 1000);
  await Counter.ensureMin(key, floor);
  return Counter.increment(key);
};

// Resolve a member by gymId with the current admin's scope, returning either
// the single member or a disambiguation list when multiple matches exist.
// Used by getMemberByGymId, updateMember, deleteMember, renewMember.
const resolveMemberForAdmin = async (req, gymId, { memberCode } = {}) => {
  // memberCode is globally unique — exact resolution, ignores scope.
  if (memberCode) {
    const member = await memberRepository.findByGymId(gymId, { memberCode });
    return member ? { member } : { member: null };
  }

  // Superadmin: never silently pick one of several duplicate numeric gymIds.
  if (req.admin?.scope === "all") {
    const matches = await memberRepository.findAllByGymId(gymId);
    if (matches.length === 1) {
      const member = await memberRepository.findByGymId(gymId);
      return member ? { member } : { member: null };
    }
    if (matches.length > 1) {
      return { members: matches.map((m) => ({ gymId: m.gymId, memberCode: m.memberCode, fullName: m.fullName, gender: m.gender, _id: m._id })) };
    }
    return { member: null };
  }

  // Trainer: resolve within authorized scope.
  const allowedGenders = scopeResolver.getScopeAllowedGenders(req);
  const member = await memberRepository.findByGymId(gymId, { allowedGenders });
  return member ? { member } : { member: null };
};

const sendMultipleMembers = (res, members) =>
  res.status(300).json({
    success: false,
    multiple: true,
    message: "Multiple members share this gym ID. Specify the member code.",
    members,
  });

export const memberController = {
  // Register a new member
  registerMember: asyncHandler(async (req, res) => {
    const data = req.body;
    const photoFile = req.file;
    const photoUrl = photoFile ? `/uploads/${photoFile.filename}` : null;

    // Validate required fields
    if (!data.fullName || !data.fatherName || !data.phone) {
      throw new ValidationError("Missing required fields: fullName, fatherName, phone");
    }

    // Parse custom fields
    const customFields = data.customFields ? JSON.parse(data.customFields) : {};
    delete data.customFields;

    // Verify requested gender against admin scope (centralized rule).
    // A client may send any gender; the backend rejects out-of-scope with 403.
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

    // Idempotency guard: if the client supplied a clientRequestId and a member
    // already exists for it (network retry / double-click), return the existing
    // member instead of creating a duplicate.
    const clientRequestId = data.clientRequestId ? String(data.clientRequestId).trim() : null;
    delete data.clientRequestId;
    if (clientRequestId) {
      const existing = await Member.findOne({ clientRequestId });
      if (existing) {
        return res.status(200).json({ success: true, data: existing, member: existing, duplicate: true });
      }
    }

    // Generate next per-gender Gym ID (atomic, never reuses deleted numbers)
    const gymId = await getNextGymId(data.gender);

    // Generate atomic member code.
    // Business rule: Male → M-series, Female → F-series, Transgender → F-series
    // (transgender consumes the female gym counter — there is NO T-series).
    const codePrefix = {
      Male: "M",
      Female: "F",
      Transgender: "F",
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

    const memberData = {
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
      ...(clientRequestId ? { clientRequestId } : {}),
    };

    // Persist the business records in a single MongoDB transaction so no
    // partial state remains if any write fails. The audit event is kept
    // OUTSIDE the transaction (an audit failure must never block registration).
    const session = await mongoose.startSession();
    let member;
    try {
      session.startTransaction();
      member = await memberRepository.create(memberData, session);

      if (paymentStatus === "paid") {
        const financeLog = new FinanceLog({
          gymId,
          memberName: member.fullName,
          amount: Number(data.amount) || 0,
          plan: data.gymPlan,
          trainingType: data.trainingType,
          type: "new",
          date: new Date(),
        });
        await financeLog.save({ session });

        const paymentLog = new PaymentLog({
          gymId,
          name: member.fullName,
          amount: Number(data.amount) || 0,
          plan: data.gymPlan,
          trainingType: data.trainingType,
          paidAt: new Date(),
          paymentMode,
          type: "new",
          dietId: data.dietId || null,
          dietName: data.dietName || null,
        });
        await paymentLog.save({ session });

        await updateTodaySummary(financeLog, session);
      }

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction().catch(() => {});
      // If the photo was uploaded but the transaction failed, remove the
      // orphaned file so the filesystem does not accumulate garbage.
      if (photoFile) {
        try {
          await fs.promises.unlink(path.join(__dirname, "..", "uploads", photoFile.filename));
        } catch {
          // cleanup is best-effort — a manual sweep can remove leftovers
        }
      }
      throw error;
    } finally {
      await session.endSession().catch(() => {});
    }

    // Audit log (outside the business transaction)
    await auditActions.memberCreated(req, member._id, {
      gymId: member.gymId,
      memberCode: member.memberCode,
      fullName: member.fullName,
      phone: member.phone,
      plan: data.gymPlan,
    });

    return res.status(201).json({ success: true, data: member, member });
  }),

  // Get all members
  getAllMembers: asyncHandler(async (req, res) => {
    const { page = 1, pageSize = 10, status, search, gender, paymentStatus, sortBy, sortOrder } = req.query;
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
    if (paymentStatus && ["paid", "not_paid"].includes(paymentStatus)) {
      filters.paymentStatus = paymentStatus;
    }

    // Server-side sort (daysLeft maps to validityEnd). Default newest-first.
    const sort = buildMemberSort(sortBy, sortOrder);

    if (search) {
      // Search stays scope-aware and paginated so the UI gets consistent
      // pagination metadata whether or not a search term is active.
      const members = await memberRepository.searchPaginated(
        search,
        Number(page),
        Number(pageSize),
        filters,
        sort
      );
      return res.json({ success: true, ...members });
    }

    const result = await memberRepository.getPaginated(
      Number(page),
      Number(pageSize),
      filters,
      sort
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

  // Get member by Gym ID (scope-aware; superadmin disambiguation)
  getMemberByGymId: asyncHandler(async (req, res) => {
    const gymId = req.params.gymId;
    const memberCode = req.query?.memberCode;

    const { member, members } = await resolveMemberForAdmin(req, gymId, { memberCode });

    if (members) {
      return sendMultipleMembers(res, members);
    }
    if (!member) {
      throw new NotFoundError("Member not found");
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
    const memberCode = req.body?.memberCode || req.query?.memberCode;

    // Load member first (scope-aware) and verify scope BEFORE mutation
    const { member: existingMember, members } = await resolveMemberForAdmin(req, lookupGymId, { memberCode });
    if (members) {
      return sendMultipleMembers(res, members);
    }
    if (!existingMember) {
      throw new NotFoundError("Member not found");
    }

    const data = req.body;
    delete data.memberCode; // memberCode is immutable

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

    const member = await memberRepository.updateByGymId(
      lookupGymId,
      data,
      expectedVersion,
      { allowedGenders: scopeResolver.getScopeAllowedGenders(req), memberCode }
    );

    if (!member) {
      // Distinguish "member deleted" (404) from "another admin edited it" (409)
      const stillExists = await memberRepository.findByGymId(lookupGymId, {
        allowedGenders: scopeResolver.getScopeAllowedGenders(req),
        memberCode,
      });
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
    const memberCode = req.body?.memberCode || req.query?.memberCode;

    // Load member first (scope-aware) and verify scope
    const { member: existingMember, members } = await resolveMemberForAdmin(req, lookupGymId, { memberCode });
    if (members) {
      return sendMultipleMembers(res, members);
    }
    if (!existingMember) {
      throw new NotFoundError("Member not found");
    }

    // Verify admin scope - only superadmin (scope=all) can delete
    if (!scopeResolver.checkMemberScope(req, existingMember.gender)) {
      throw new ForbiddenError("Access denied: only superadmin can delete members");
    }

    const member = await memberRepository.deleteByGymId(lookupGymId, {
      allowedGenders: scopeResolver.getScopeAllowedGenders(req),
      memberCode,
    });

    if (!member) {
      throw new NotFoundError("Member not found");
    }

    // Audit log
    await auditActions.memberDeleted(req, member._id);

    return res.json({ success: true, message: "Member deleted successfully" });
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
      // Public lookup has no admin scope: if the numeric gymId is ambiguous
      // (duplicate across genders), return "not found" rather than silently
      // resolving an arbitrary member.
      const matches = await memberRepository.findAllByGymId(cleanGymId);
      if (matches.length === 1) {
        member = matches[0];
      } else if (matches.length === 0) {
        member = null;
      } else {
        return res.json({
          success: true,
          data: {
            found: false,
            ambiguous: true,
            message: "Multiple members share this gym ID. Use phone or contact the gym.",
          },
        });
      }
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
    const memberCode = req.body?.memberCode || req.query?.memberCode;

    // Load member first (scope-aware) and verify scope BEFORE mutation
    const { member: existingMember, members } = await resolveMemberForAdmin(req, lookupGymId, { memberCode });
    if (members) {
      return sendMultipleMembers(res, members);
    }
    if (!existingMember) {
      throw new NotFoundError("Member not found");
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
    }, expectedVersion, {
      allowedGenders: scopeResolver.getScopeAllowedGenders(req),
      memberCode,
    });

    if (!updatedMember) {
      // Distinguish "member deleted" (404) from "another admin edited it" (409)
      const stillExists = await memberRepository.findByGymId(lookupGymId, {
        allowedGenders: scopeResolver.getScopeAllowedGenders(req),
        memberCode,
      });
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
