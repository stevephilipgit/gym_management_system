// controllers/deviceController.js - Trainer device management
//
// Phase 2 — the trainer-facing device layer. Server-authoritative:
//   - a trainer may only view/deactivate their OWN registrations
//   - Super Admin has global authority (revoke/rotate/reassign)
//
// These endpoints require an authenticated admin session (adminAuth). The
// physical Kiosk is created/managed by Super Admin via the existing
// /api/admin/kiosks routes; trainer device management only BINDS a browser
// to an existing Kiosk — it never creates a physical device.

import mongoose from "mongoose";
import {
  deactivateRegistration,
  lockRegistration,
  unlockRegistration,
  revokeRegistration,
  reactivateRegistration,
  rotateRegistration,
  reassignKioskScope,
  DeviceError,
} from "../services/deviceRegistrationService.js";

const Kiosk = mongoose.model("Kiosk");

const asAdmin = (req) => ({
  trainerId: req.admin?.id,
  trainerScope: req.admin?.scope,
  isSuperAdmin: req.admin?.role === "superadmin",
});

// POST /api/admin/devices/:registrationId/deactivate
// Trainer may deactivate only their own; Super Admin any.
export const deactivate = async (req, res) => {
  try {
    const result = await deactivateRegistration({
      registrationId: String(req.params.registrationId),
      ...asAdmin(req),
    });
    return res.json({ success: true, registration: result });
  } catch (err) {
    if (err instanceof DeviceError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    throw err;
  }
};

// POST /api/admin/devices/:registrationId/lock
// Trainer may lock only their OWN active device (temporary pause, preserves credentials).
export const lock = async (req, res) => {
  try {
    const result = await lockRegistration({
      registrationId: String(req.params.registrationId),
      ...asAdmin(req),
    });
    return res.json({ success: true, locked: true, registration: result });
  } catch (err) {
    if (err instanceof DeviceError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    throw err;
  }
};

// POST /api/admin/devices/:registrationId/unlock
// Trainer may unlock only their OWN locked device (resumes attendance).
export const unlock = async (req, res) => {
  try {
    const result = await unlockRegistration({
      registrationId: String(req.params.registrationId),
      ...asAdmin(req),
    });
    return res.json({ success: true, locked: false, registration: result });
  } catch (err) {
    if (err instanceof DeviceError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    throw err;
  }
};

// POST /api/admin/devices/:registrationId/reactivate
// Trainer may reactivate their OWN deactivationReason="trainer" registration.
// Returns a FRESH server-generated apiKey (old credential stays unusable).
export const reactivate = async (req, res) => {
  try {
    const result = await reactivateRegistration({
      registrationId: String(req.params.registrationId),
      trainerId: req.admin?.id,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof DeviceError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    throw err;
  }
};
// POST /api/admin/devices/:registrationId/revoke (Super Admin only)
export const revoke = async (req, res) => {
  try {
    const result = await revokeRegistration({
      registrationId: String(req.params.registrationId),
      ...asAdmin(req),
    });
    return res.json({ success: true, registration: result });
  } catch (err) {
    if (err instanceof DeviceError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    throw err;
  }
};

// POST /api/admin/devices/:registrationId/rotate (Super Admin only)
export const rotate = async (req, res) => {
  try {
    const result = await rotateRegistration({
      registrationId: String(req.params.registrationId),
      ...asAdmin(req),
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof DeviceError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    throw err;
  }
};

// POST /api/admin/devices/kiosks/:kioskId/reassign-scope (Super Admin only)
// Body: { scope }
export const reassignScope = async (req, res) => {
  try {
    const result = await reassignKioskScope({
      kioskId: String(req.params.kioskId),
      newScope: req.body?.scope,
      ...asAdmin(req),
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof DeviceError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    throw err;
  }
};