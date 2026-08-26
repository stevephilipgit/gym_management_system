// controllers/draftController.js - Per-session registration draft
//
// Drafts are scoped by (req.admin.id, req.sessionId, "register") so only the
// same authenticated session may read/update/delete its own draft. A female
// trainer can never retrieve a male trainer's (or superadmin's) draft, and a
// second device/session of the same account gets an independent draft.
//
// Draft data may contain sensitive fields (phone, Aadhaar, medical). It is
// never logged and never placed in URLs. No auth tokens are stored in drafts.

import DraftRegistration from "../models/DraftRegistration.js";
import { asyncHandler } from "../core/errorHandler.js";

const DRAFT_TYPE = "register";

export const getDraft = asyncHandler(async (req, res) => {
  const draft = await DraftRegistration.findOne({
    adminId: req.admin.id,
    sessionId: req.sessionId,
    draftType: DRAFT_TYPE,
  }).lean();

  return res.json({ success: true, data: draft ? draft.data : null });
});

export const saveDraft = asyncHandler(async (req, res) => {
  const { data } = req.body || {};

  if (data === undefined || data === null) {
    return res.status(400).json({ success: false, message: "Draft data is required" });
  }

  // Upsert scoped strictly to the authenticated admin + session.
  const draft = await DraftRegistration.findOneAndUpdate(
    { adminId: req.admin.id, sessionId: req.sessionId, draftType: DRAFT_TYPE },
    { $set: { data } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return res.json({ success: true, data: draft.data });
});

export const deleteDraft = asyncHandler(async (req, res) => {
  await DraftRegistration.deleteOne({
    adminId: req.admin.id,
    sessionId: req.sessionId,
    draftType: DRAFT_TYPE,
  });

  return res.json({ success: true, message: "Draft discarded" });
});

export default { getDraft, saveDraft, deleteDraft };
