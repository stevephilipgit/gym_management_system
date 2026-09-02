// controllers/kioskAdminController.js - Superadmin kiosk device management
//
// Staff-facing management of trusted kiosk identities: create, list, update,
// rotate keys, and revoke (disable/delete). This gives the gym a way to rotate
// or revoke a compromised kiosk WITHOUT a code deployment.
//
// A kiosk is a TRUSTED DEVICE only — it has no customer gender/scope. One
// shared kiosk serves Male, Female and Transgender customers.
//
// All routes are superadmin-only (adminAuth + requireRole("superadmin")).

import Kiosk from "../models/Kiosk.js";
import logger from "../core/logger.js";

const toPublicKiosk = (k) => ({
  _id: k._id,
  kioskId: k.kioskId,
  name: k.name,
  scope: k.scope,
  enabled: k.enabled,
  lastUsedAt: k.lastUsedAt,
  createdAt: k.createdAt,
  updatedAt: k.updatedAt,
});

/**
 * POST /api/admin/kiosks  — create a kiosk. No credential is generated here;
 * device authentication is handled by DeviceRegistration (direct activation).
 * Body: { kioskId, name?, scope? }
 */
export const createKiosk = async (req, res) => {
  try {
    const { kioskId, name = "", scope = "male" } = req.body || {};

    if (!kioskId || !/^[a-zA-Z0-9_-]+$/.test(String(kioskId))) {
      return res.status(400).json({ success: false, message: "kioskId is required (letters, numbers, - and _ only)" });
    }

    const existing = await Kiosk.findOne({ kioskId });
    if (existing) {
      return res.status(409).json({ success: false, message: "A kiosk with this kioskId already exists" });
    }

    const kiosk = await Kiosk.create({
      kioskId: String(kioskId).trim(),
      name: String(name).trim(),
      scope,
      enabled: true,
      createdBy: req.admin?.id || null,
    });

    logger.info(`Kiosk created: ${kiosk.kioskId}`, { adminId: req.admin?.id });

    return res.status(201).json({
      success: true,
      message: "Kiosk created. A trainer activates this device from the Trainer Portal (My Attendance Devices) using a one-time activation code to enable the customer attendance page.",
      kiosk: toPublicKiosk(kiosk.toObject()),
    });
  } catch (err) {
    logger.error("Error creating kiosk", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to create kiosk" });
  }
};

/**
 * GET /api/admin/kiosks  — list all kiosks (no secret material).
 */
export const listKiosks = async (req, res) => {
  try {
    const kiosks = await Kiosk.find().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, kiosks: kiosks.map(toPublicKiosk) });
  } catch (err) {
    logger.error("Error listing kiosks", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to list kiosks" });
  }
};

/**
 * PATCH /api/admin/kiosks/:id  — update name/enabled.
 * Body: { name?, enabled? }
 */
export const updateKiosk = async (req, res) => {
  try {
    const kiosk = await Kiosk.findById(req.params.id);
    if (!kiosk) {
      return res.status(404).json({ success: false, message: "Kiosk not found" });
    }

    const { name, enabled } = req.body || {};

    if (name !== undefined) kiosk.name = String(name).trim();
    if (enabled !== undefined) kiosk.enabled = !!enabled;

    await kiosk.save();
    logger.info(`Kiosk updated: ${kiosk.kioskId}`, { adminId: req.admin?.id });
    return res.json({ success: true, kiosk: toPublicKiosk(kiosk.toObject()) });
  } catch (err) {
    logger.error("Error updating kiosk", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to update kiosk" });
  }
};

/**
 * DELETE /api/admin/kiosks/:id  — permanently revoke a kiosk.
 */
export const deleteKiosk = async (req, res) => {
  try {
    const kiosk = await Kiosk.findByIdAndDelete(req.params.id);
    if (!kiosk) {
      return res.status(404).json({ success: false, message: "Kiosk not found" });
    }
    logger.info(`Kiosk deleted (revoked): ${kiosk.kioskId}`, { adminId: req.admin?.id });
    return res.json({ success: true, message: "Kiosk revoked and deleted" });
  } catch (err) {
    logger.error("Error deleting kiosk", { error: err.message });
    return res.status(500).json({ success: false, message: "Failed to delete kiosk" });
  }
};