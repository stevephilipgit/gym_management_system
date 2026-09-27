// scopeResolver.js - Centralized admin scope + member gender verification
//
// This is the single source of truth for scope rules. Controllers MUST
// NOT re-implement these rules inline; they should use:
//   scopeResolver.getScopeAllowedGenders(req)   → ["Male"] | ["Female","Transgender"] | all
//   scopeResolver.buildGenderFilter(req)        → { branchId } | { branchId, gender: { $in } }
//   scopeResolver.buildBranchFilter(req)        → { branchId }  (non-gender collections)
//   scopeResolver.checkMemberScope(req, gender) → boolean
//
// TWO tenancy layers compose into every query:
//   1. BRANCH partition (req.branchId)  — always applied when present.
//   2. GENDER scope (req.admin.scope)   — applied where the collection has a
//      gender dimension.
//
// The scope is always derived from the authenticated session (req.admin)
// attached by adminAuth/branchContext. Client-supplied branch/gender/scope
// values are never trusted.

const SCOPE_TO_GENDERS = {
  all: ["Male", "Female", "Transgender"],
  male: ["Male"],
  female_plus_transgender: ["Female", "Transgender"],
};

const SCOPE_RULES = {
  all: (memberGender) => true,
  male: (memberGender) => memberGender === "Male",
  female_plus_transgender: (memberGender) =>
    memberGender === "Female" || memberGender === "Transgender",
};

function verifyAdminScope(adminScope, memberGender) {
  const rule = SCOPE_RULES[adminScope];
  if (!rule) return false;
  return rule(memberGender);
}

function checkMemberScope(req, memberGender) {
  const adminScope = req.admin?.scope;
  if (!adminScope) return false;
  return verifyAdminScope(adminScope, memberGender);
}

// Return the list of genders the current admin may access.
function getScopeAllowedGenders(req) {
  return SCOPE_TO_GENDERS[req.admin?.scope] || [];
}

// Return a MongoDB query fragment that constrains a collection to the admin's
// BRANCH partition AND gender scope. branchId comes from branchContext
// (server-derived from the admin document — never from the client).
function buildGenderFilter(req) {
  const filter = {};
  if (req.branchId) {
    filter.branchId = req.branchId;
  }
  const allowed = getScopeAllowedGenders(req);
  if (allowed && allowed.length > 0) {
    filter.gender = { $in: allowed };
  }
  return filter;
}

// Branch-only filter for collections without a gender dimension
// (FinanceLog, PaymentLog, DailySummary, Attendance, Admin, Kiosk, Enquiry).
// Throws if the request has no branch context — fail closed, never an
// unscoped (cross-branch) query.
function buildBranchFilter(req) {
  if (!req.branchId) {
    const err = new Error("Forbidden: No branch context.");
    err.statusCode = 403;
    throw err;
  }
  return { branchId: req.branchId };
}

// Constrain a Member query to the admin's branch + gender scope by returning
// matching _ids (used for collections that reference members, e.g. attendance).
async function getScopedMemberIds(req, MemberModel, extraFilter = {}) {
  const filter = { ...extraFilter };
  if (req.branchId) filter.branchId = req.branchId;
  const allowed = getScopeAllowedGenders(req);
  if (allowed && allowed.length > 0) {
    filter.gender = { $in: allowed };
  } else if (!req.branchId) {
    return null; // null = no restriction (pre-branch-context callers only)
  }
  const memberIds = await MemberModel.find(filter)
    .select("_id")
    .lean();
  return memberIds.map((m) => m._id);
}

export default {
  verifyAdminScope,
  checkMemberScope,
  getScopeAllowedGenders,
  buildGenderFilter,
  buildBranchFilter,
  getScopedMemberIds,
  SCOPE_TO_GENDERS,
  SCOPE_RULES,
};
