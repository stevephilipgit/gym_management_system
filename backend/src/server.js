// Authoritative business timezone — MUST be set before any Date usage so
// attendance day boundaries, business hours, late-punch threshold, and cron
// schedules all operate in gym-local time (Asia/Kolkata). node-cron also gets
// an explicit `timezone` so the scheduler and the date math never diverge.
process.env.TZ = process.env.BUSINESS_TIMEZONE || "Asia/Kolkata";

// gym_project_backend/server.js
import "express-async-errors";
import dotenv from "dotenv";
import compression from "compression";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";

// ============= CORE IMPORTS =============
import config from "./config/index.js";
import connectDB from "./config/db.js";
import { validateEnv } from "./config/validateEnv.js";

validateEnv();
import logger from "./core/logger.js";
import { errorHandler } from "./core/errorHandler.js";

// ✅ Import models early to register them with Mongoose
import "./models/Attendance.js";
import "./models/SystemSettings.js";
import "./models/Member.js";
import "./models/Enquiry.js";
import "./models/ChatSession.js";
import "./models/ChatMessage.js";
import "./models/AIUserMemory.js";
import "./models/Kiosk.js";
import "./models/DeviceRegistration.js";
import "./models/DeviceActivation.js";
import "./models/AttendanceExport.js";
import "./models/Notification.js";

// ============= MIDDLEWARE IMPORTS =============
import { helmetMiddleware, additionalHeaders } from "./middleware/securityHeaders.js";
import { noSqlSanitizer, hppProtection } from "./middleware/sanitizer.js";
import { auditLogger, AuditLog } from "./middleware/requestLogger.js";

// ROUTES
import adminRoutes from "./routes/adminRoutes.js";
import memberRoutes from "./routes/memberRoutes.js";
import packageRoutes from "./routes/packageRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import financeRoutes from "./routes/financeRoutes.js";
import fieldRoutes from "./routes/fieldRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import dietRoutes from "./routes/dietRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import adminAuth from "./middleware/adminAuth.js";
import requireRole from "./middleware/requireRole.js";
import { initDailyTasks } from "./services/summaryService.js";
import { CRON_CONFIG } from "./config/cronConfig.js";
import { executeFinanceReconciliation } from "./jobs/financeReconcileJob.js";
import healthController from "./controllers/healthController.js";

// ✅ NEW: Attendance System Routes
import attendanceRoutes from "./routes/attendanceRoutes.js";
// ✅ NEW: Public customer kiosk punch route (kioskAuth boundary)
import kioskRoutes from "./routes/kioskRoutes.js";
// ✅ NEW: Superadmin kiosk device management routes
import kioskAdminRoutes from "./routes/kioskAdminRoutes.js";
import deviceRoutes from "./routes/deviceRoutes.js";
import reportsRoutes from "./routes/reportsRoutes.js";
import systemSettingsRoutes from "./routes/systemSettingsRoutes.js";
import notificationRoutes, { exportDownloadRouter } from "./routes/notificationRoutes.js";

// ✅ NEW: Enquiry System
import enquiryRoutes from "./routes/enquiryRoutes.js";
import { cleanupOldEnquiries } from "./controllers/enquiryController.js";

// ✅ NEW: Attendance Jobs (Cron)
import cron from "node-cron";
import { autoCloseJob, startupRecoveryJob, staleAutoCloseJob } from "./jobs/attendanceJobs.js";
import { attendanceDailyExportJob, retryPendingNotifications, cleanupExpiredExports } from "./jobs/attendanceDailyExportJob.js";
import systemSettingsService from "./services/systemSettingsService.js";

// ✅ AI: session retention lifecycle
import aiConfig from "./config/aiConfig.js";
import { runSessionLifecycle } from "./services/ai/sessionService.js";

dotenv.config();
const app = express();

// Resolve __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Trust proxy hops so req.ip / rate limiting work correctly behind nginx or a
// cloud load balancer. Off (0) by default; set TRUST_PROXY=1 in production.
if (String(process.env.TRUST_PROXY || "0") === "1") {
  app.set("trust proxy", 1);
}

/* ============================================================
   REQUEST ID MIDDLEWARE - For traceability
============================================================ */
app.use((req, res, next) => {
  req.id = uuid();
  req.logger = logger.child({ requestId: req.id });
  next();
});

/* ============================================================
   SECURITY MIDDLEWARE
============================================================ */
app.use(
  compression({
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
    threshold: 1024,
  })
);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(helmetMiddleware);
app.use(additionalHeaders);

/* ============================================================
   CORS — MUST COME BEFORE ALL ROUTES
============================================================ */
const allowedOrigins = config.app.allowedOrigins;

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-Session-Id",
      "X-Kiosk-Id",
      "X-Kiosk-Key",
      "X-Attendance-Source",
    ],
  })
);

/* ============================================================
   JSON + COOKIES
============================================================ */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(noSqlSanitizer);
app.use(hppProtection);
app.use(auditLogger);

// Semantic audit events (auditActions.*) persist to the auditlogs collection.
// Without this, utils/auditLog.js only wrote to Winston file logs.
app.locals.auditLogModel = AuditLog;

/* ============================================================
   STATIC (Uploads)
============================================================ */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ============================================================
   RATE LIMIT FOR ALL API ROUTES
============================================================ */
app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { message: "Too many requests. Slow down." },
  })
);

/* ============================================================
   ROUTES — mount after all middleware
============================================================ */
app.use("/api/admin", adminRoutes);
app.use("/api/fields", fieldRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/diets", dietRoutes);
app.use("/api/public", publicRoutes);

// ⭐ FIX: Finance route must come AFTER CORS + JSON + COOKIE + limiter
app.use("/api/finance", financeRoutes);
// AI assistant is a superadmin-only module.
app.use("/api/ai", adminAuth, requireRole("superadmin"), aiRoutes);

// ✅ NEW: Attendance System Routes
// Public customer kiosk (kioskAuth) is mounted BEFORE the admin attendance
// router so the /api/attendance/kiosk/* prefix is never intercepted by it.
app.use("/api/attendance/kiosk", kioskRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/settings", systemSettingsRoutes);

// ✅ Superadmin-only kiosk device management (create/rotate/disable/revoke).
// Kiosk principals are separate from admin principals; only a superadmin can
// manage the devices themselves.
app.use("/api/admin/kiosks", adminAuth, requireRole("superadmin"), kioskAdminRoutes);

// ✅ Trainer + Super Admin device REGISTRATION layer (browser ↔ physical Kiosk).
// Trainer activates/deactivates own registrations; Super Admin has global
// authority (revoke/rotate/reassign). Physical Kiosk inventory stays under
// /api/admin/kiosks.
app.use("/api/admin/devices", deviceRoutes);

// ✅ NEW: In-app admin notifications + daily attendance report download.
// Both are adminAuth-protected; superadmin-only role checks live in the
// controller (the daily CSV is a cross-gender audit artifact).
app.use("/api/notifications", notificationRoutes);
app.use("/api/exports", exportDownloadRouter);

// ✅ NEW: Enquiry System Routes
app.use("/api/enquiries", enquiryRoutes);

/* ============================================================
   HEALTH CHECK
============================================================ */
app.get("/", (req, res) => {
  res.json({ message: "Giri Gym Backend Running 🚀" });
});

app.get("/api/health", healthController.healthCheck);
app.get("/api/health/info", healthController.healthInfo);

/* ============================================================
   API CATCH-ALL — Reject unknown /api paths.
   Ensures any unregistered endpoint returns 404 and never leaks
   resources to unauthenticated clients.
============================================================ */
app.use("/api", (req, res) => {
  res.status(404).json({ success: false, message: "Endpoint not found" });
});

/* ============================================================
   ERROR HANDLER (Must be last)
============================================================ */
app.use(errorHandler);

/* ============================================================
   START SERVER + DB
============================================================ */

let server;

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  if (server) {
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
  }
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received: closing HTTP server");
  if (server) {
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
  }
});

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDB();

    // Initialize daily tasks
    initDailyTasks();
    logger.info("📅 Daily tasks initialized");

    // ✅ NEW: Startup Recovery Job (auto-close yesterday's open records if server was down)
    await startupRecoveryJob();

    // ✅ All background job schedules, enable flags and the business timezone
    // come from CRON_CONFIG (src/config/cronConfig.js), so every cadence is
    // tunable through env vars without editing this file. Each task runs in its
    // own try/catch so one failing job can never take the scheduler down.
    const scheduleJob = (name, label, task) => {
      const job = CRON_CONFIG.jobs[name];
      if (!job.enabled) {
        logger.info(`⏭️ ${label} disabled by configuration`);
        return;
      }
      cron.schedule(
        job.schedule,
        async () => {
          try {
            await task();
          } catch (err) {
            logger.error(`${label} failed`, { error: err.message });
          }
        },
        { timezone: CRON_CONFIG.timezone }
      );
      logger.info(`✅ ${label} scheduled at ${job.schedule} (${CRON_CONFIG.timezone})`);
    };

    // ✅ Auto-close yesterday's open attendance records at 23:59 IST.
    scheduleJob("autoCloseDay", "Attendance auto-close job", () => {
      logger.info("Executing scheduled auto-close job...");
      return autoCloseJob();
    });

    // ✅ Stale record auto-close: close records > 2 hours old left by a crash.
    scheduleJob("staleAutoClose", "Stale record auto-close", staleAutoCloseJob);

    // ✅ Daily enquiry cleanup.
    scheduleJob("enquiryCleanup", "Enquiry cleanup", async () => {
      const deleted = await cleanupOldEnquiries();
      logger.info(`[Enquiry Cleanup] Deleted ${deleted} old records`);
    });

    // ✅ Previous-day attendance export at 00:05 IST, after the 23:59
    // auto-close has run. Idempotent + crash safe; notifies superadmin.
    scheduleJob("attendanceExport", "Daily attendance export", () => {
      logger.info("Executing scheduled daily attendance export...");
      return attendanceDailyExportJob();
    });

    // ✅ Notification retry sweep: delivers notifications for exports that are
    // ready but not yet notified (never regenerates the CSV).
    scheduleJob("notificationRetry", "Notification retry sweep", retryPendingNotifications);

    // ✅ Export retention cleanup. No-op until export_retention_days > 0 is
    // configured in SystemSettings.
    scheduleJob("exportRetention", "Export retention cleanup", async () => {
      const settings = await systemSettingsService.getSettings();
      await cleanupExpiredExports(settings);
    });

    // ✅ Financial self-healing: recompute DailySummary from FinanceLog over the
    // configured lookback window and report the drift it corrected. Same
    // implementation the manual POST /api/finance/reconcile endpoint uses.
    scheduleJob("financialReconciliation", "Financial reconciliation", () =>
      executeFinanceReconciliation()
    );

    // ✅ AI: daily session lifecycle (archive inactive → purge expired archived).
    // Idempotent + bounded + restart-safe; never touches AIUserMemory.
    scheduleJob("aiSessionLifecycle", "AI session lifecycle", async () => {
      const result = await runSessionLifecycle({
        archiveAfterDays: aiConfig.sessionArchiveDays,
        retentionDays: aiConfig.sessionRetentionDays,
      });
      logger.info("[AISessionCleanup] Lifecycle run", result);
    });

    // Start listening
    server = app.listen(config.app.port, () => {
      logger.info(`🚀 Server running on port ${config.app.port} in ${config.env} mode`);
    });
  } catch (err) {
    logger.error("Failed to start server", { error: err.message });
    process.exit(1);
  }
};

startServer();
