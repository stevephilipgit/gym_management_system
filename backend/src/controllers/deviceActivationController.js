import { generateActivation, redeemActivation, DeviceActivationError } from "../services/deviceActivationService.js";
import { listTrainerRegistrations } from "../services/deviceRegistrationService.js";

// POST /api/admin/devices/activate/generate (Super Admin)
// Request: { trainerId } ONLY. Scope derived server-side from the Trainer.
export const generate = async (req, res) => {
  try {
    const { trainerId } = req.body || {};
    if (!trainerId) {
      return res.status(400).json({ success: false, message: "trainerId is required" });
    }

    const result = await generateActivation({
      trainerId: String(trainerId),
      createdBy: req.admin?.id,
    });

    return res.status(201).json({ success: true, activation: result });
  } catch (err) {
    if (err instanceof DeviceActivationError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    throw err;
  }
};

// GET /api/admin/devices/my — Trainer's own registrations.
export const listMyDevices = async (req, res) => {
  try {
    const result = await listTrainerRegistrations({ trainerId: req.admin.id });
    return res.json({ success: true, registrations: result.registrations });
  } catch (err) {
    throw err;
  }
};

// GET /api/admin/devices/all (Super Admin) — active registrations across Trainers.
export const listAllRegistrations = async (req, res) => {
  try {
    if (req.admin?.role !== "superadmin") {
      return res.status(403).json({ success: false, message: "Only Super Admin can list all devices" });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const DeviceRegistration = (await import("../models/DeviceRegistration.js")).default;
    const Admin = (await import("../models/Admin.js")).default;
    const skip = Math.max(0, (page - 1) * limit);
    const docs = await DeviceRegistration.find({ active: true })
      .sort({ activatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    const trainerIds = docs.map((d) => d.trainerId);
    const trainers = await Admin.find({ _id: { $in: trainerIds } })
      .select("fullName username scope")
      .lean();
    const map = new Map(trainers.map((t) => [String(t._id), t]));
    const registrations = docs.map((d) => ({
      registrationId: d.registrationId,
      kioskId: d.kioskId,
      trainerId: d.trainerId,
      trainerName: map.get(String(d.trainerId))?.fullName || map.get(String(d.trainerId))?.username || "",
      browserDeviceId: d.browserDeviceId,
      active: d.active,
      activatedAt: d.activatedAt,
      lastSeenAt: d.lastSeenAt,
    }));
    return res.json({ success: true, registrations, page, limit });
  } catch (err) {
    throw err;
  }
};

// POST /api/admin/devices/activate — Trainer redeems on their chosen browser.
// Request: { code|qrSecret, password, browserDeviceId }. Trainer identity from
// the authenticated session (req.admin.id) — never from the body.
export const redeem = async (req, res) => {
  try {
    const { code, qrSecret, password, browserDeviceId } = req.body || {};
    const trainerId = req.admin?.id;

    if (!trainerId || !browserDeviceId || !password) {
      return res.status(400).json({ success: false, message: "password and browserDeviceId are required" });
    }
    if (!code && !qrSecret) {
      return res.status(400).json({ success: false, message: "Activation code or QR secret is required" });
    }

    const result = await redeemActivation({
      trainerId: String(trainerId),
      browserDeviceId: String(browserDeviceId),
      code: code ? String(code) : undefined,
      qrSecret: qrSecret ? String(qrSecret) : undefined,
      password: String(password),
      req,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof DeviceActivationError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    throw err;
  }
};
