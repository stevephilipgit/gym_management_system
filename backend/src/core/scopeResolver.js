// scopeResolver.js - Centralized admin scope + member gender verification
//
// This is the single source of truth for gender-scope rules. Controllers MUST
// NOT re-implement these rules inline; they should use:
//   scopeResolver.getScopeAllowedGenders(req)   → ["Male"] | ["Female","Transgender"] | all
//   scopeResolver.buildGenderFilter(req)        → {} | { gender: { $in: [...] } }
//   scopeResolver.checkMemberScope(req, gender) → boolean
//
// The scope is always derived from the authenticated session (req.admin.scope)
// signed into the JWT. Client-supplied gender/scope values are never trusted.

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

// Return a MongoDB query fragment that constrains a collection by the admin's
// gender scope. Empty object = no restriction (superadmin/all).
function buildGenderFilter(req) {
  const allowed = getScopeAllowedGenders(req);
  if (!allowed || allowed.length === 0) return {};
  return { gender: { $in: allowed } };
}

// Constrain a Member query to the admin's scope by returning matching _ids
// (used for collections that reference members, e.g. attendance).
async function getScopedMemberIds(req, MemberModel, extraFilter = {}) {
  const allowed = getScopeAllowedGenders(req);
  if (!allowed || allowed.length === 0) return null; // null = no restriction
  const memberIds = await MemberModel.find({ ...extraFilter, gender: { $in: allowed } })
    .select("_id")
    .lean();
  return memberIds.map((m) => m._id);
}

export default {
  verifyAdminScope,
  checkMemberScope,
  getScopeAllowedGenders,
  buildGenderFilter,
  getScopedMemberIds,
  SCOPE_TO_GENDERS,
  SCOPE_RULES,
};
