import express from "express";
import invoiceController from "../controllers/invoiceController.js";
import adminAuth from "../middleware/adminAuth.js";
import { adminLimiter, sensitiveLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
router.use(adminLimiter);

/* ============================================================
   INVOICE ROUTES
============================================================ */

// POST /api/invoices/:paymentLogId/generate-share-link
router.post("/:paymentLogId/generate-share-link", sensitiveLimiter, adminAuth, invoiceController.generateInvoice);

// GET /api/invoices/:paymentLogId/download
router.get("/:paymentLogId/download", sensitiveLimiter, adminAuth, invoiceController.getInvoiceByLink);

export default router;
