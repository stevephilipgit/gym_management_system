// utils/scopeGenders.js - Frontend mirror of backend/src/core/scopeResolver.js
//
// Single source of truth for what genders an admin scope may register/view.
// Keep in sync with the backend mapping (scopeResolver.js) — the backend
// remains the enforcement boundary; this only drives form options/defaults.

export const SCOPE_TO_GENDERS = {
  all: ["Male", "Female", "Transgender"],
  male: ["Male"],
  female_plus_transgender: ["Female", "Transgender"],
};

// Genders the given admin scope may register. Returns all three when the
// scope is unknown (backend still enforces the real rule).
export const allowedGendersForScope = (scope) =>
  SCOPE_TO_GENDERS[scope] || ["Male", "Female", "Transgender"];

// The default gender for a form: the first allowed gender, unless the current
// value is already allowed (preserves a user's explicit selection).
export const defaultGenderForScope = (scope, currentGender) => {
  const allowed = allowedGendersForScope(scope);
  if (allowed.length > 0 && !allowed.includes(currentGender)) {
    return allowed[0];
  }
  return currentGender;
};
