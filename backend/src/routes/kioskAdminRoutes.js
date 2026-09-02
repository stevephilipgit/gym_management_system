// routes/kioskAdminRoutes.js - Superadmin kiosk device management routes
//
// These routes are mounted behind adminAuth + requireRole("superadmin") in
// server.js. They manage trusted kiosk identities (create / rotate / disable /
// revoke) without a code deployment.

import express from "express";
import {
  createKiosk,
  listKiosks,
  updateKiosk,
  deleteKiosk,
} from "../controllers/kioskAdminController.js";

const router = express.Router();

// POST /api/admin/kiosks            — create kiosk (returns API key once)
router.post("/", createKiosk);

// GET  /api/admin/kiosks            — list kiosks
router.get("/", listKiosks);

// PATCH /api/admin/kiosks/:id       — update name/enabled
router.patch("/:id", updateKiosk);

// DELETE /api/admin/kiosks/:id      — revoke/delete kiosk
router.delete("/:id", deleteKiosk);

export default router;