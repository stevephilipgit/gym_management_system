// scopeResolver.js - Centralized admin scope + member gender verification

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

export default {
  verifyAdminScope,
  checkMemberScope,
  SCOPE_RULES,
};
