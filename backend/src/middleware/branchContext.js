// middleware/branchContext.js — Branch partition context + trainer delete guard
//
// Runs at the TAIL of adminAuth (adminAuth invokes it before next()), so every
// admin-authenticated route — including the ~40 chains that do NOT stack
// requireRole — receives branch context and the delete guard automatically.
//
// Responsibilities:
//   1. Attach `req.branchId = req.admin.branchId` for the request lifecycle.
//      Controllers use it directly (non-gender collections) or through
//      scopeResolver.buildBranchFilter / buildGenderFilter.
//   2. Fail closed: an authenticated admin WITHOUT a branch cannot act
//      (pre-migration account) — 403, never an unscoped query.
//   3. TRAINER DELETE GUARD: trainers have CREATE/READ/UPDATE rights only.
//      Any DELETE from role=trainer is rejected here, in ONE place, so no
//      route can forget to stack a guard.
//
// No-op when `req.admin` is absent (public routes, kioskAuth principal,
// adminAttendanceAuth principal) — those attach their own branch context.

export const NO_BRANCH_MESSAGE = "Forbidden: No branch context.";
export const TRAINER_DELETE_MESSAGE = "Forbidden: Trainers cannot delete records.";

export default function branchContext(req, res, next) {
  // Public / kiosk / attendance-token requests have no admin principal here.
  if (!req.admin) {
    return next();
  }

  const branchId = req.admin.branchId;
  if (!branchId) {
    return res.status(403).json({ success: false, message: NO_BRANCH_MESSAGE });
  }
  req.branchId = branchId;

  if (req.method === "DELETE" && req.admin.role === "trainer") {
    return res.status(403).json({ success: false, message: TRAINER_DELETE_MESSAGE });
  }

  return next();
}
