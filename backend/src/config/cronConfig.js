// config/cronConfig.js — single source of truth for every background job.
//
// Schedules, enable flags, timezone and reconciliation thresholds live here so
// they can be tuned per environment (env vars) without touching server.js.
// config/index.js re-exports this object as `config.cron`, so consumers may
// keep using `config.cron.*`; new code should prefer importing CRON_CONFIG.
//
// Every `cron.schedule(...)` call must pass `{ timezone: CRON_CONFIG.timezone }`
// and server.js pins `process.env.TZ` to the same value, so the scheduler and
// the `setHours(0,0,0,0)` date math can never disagree about "today".
import dotenv from "dotenv";

dotenv.config();

const boolFromEnv = (value, fallback = "true") =>
  String(value ?? fallback).toLowerCase() !== "false";

const intFromEnv = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const floatFromEnv = (value, fallback) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const CRON_CONFIG = {
  timezone: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
  jobs: {
    // Nightly self-heal: recomputes DailySummary from FinanceLog over a
    // lookback window and reports the drift it corrected.
    financialReconciliation: {
      enabled: boolFromEnv(process.env.CRON_FINANCE_RECONCILE_ENABLED),
      schedule: process.env.CRON_FINANCE_RECONCILE_SCHEDULE || "30 3 * * *", // 03:30 IST
      lookbackDays: intFromEnv(process.env.CRON_FINANCE_RECONCILE_LOOKBACK, 7),
      // Absolute delta (currency units) above which a correction is reported
      // as drift. Guards against float noise from the $inc chain.
      driftAlertThreshold: floatFromEnv(process.env.CRON_FINANCE_DRIFT_THRESHOLD, 0.01),
    },
    // Close yesterday's open attendance records after the last punch of the day.
    autoCloseDay: {
      enabled: boolFromEnv(process.env.CRON_AUTO_CLOSE_ENABLED),
      schedule: process.env.CRON_AUTO_CLOSE_SCHEDULE || "59 23 * * *", // 23:59 IST
    },
    // Close records that were left open by a crash/down server.
    staleAutoClose: {
      enabled: boolFromEnv(process.env.CRON_STALE_AUTO_CLOSE_ENABLED),
      schedule: process.env.CRON_STALE_AUTO_CLOSE_SCHEDULE || "*/30 * * * *",
    },
    enquiryCleanup: {
      enabled: boolFromEnv(process.env.CRON_ENQUIRY_CLEANUP_ENABLED),
      schedule: process.env.CRON_ENQUIRY_CLEANUP_SCHEDULE || "0 2 * * *",
    },
    // Runs after autoCloseDay so the export covers a fully closed day.
    attendanceExport: {
      enabled: boolFromEnv(process.env.CRON_ATTENDANCE_EXPORT_ENABLED),
      schedule: process.env.CRON_ATTENDANCE_EXPORT_SCHEDULE || "5 0 * * *", // 00:05 IST
    },
    notificationRetry: {
      enabled: boolFromEnv(process.env.CRON_NOTIFICATION_RETRY_ENABLED),
      schedule: process.env.CRON_NOTIFICATION_RETRY_SCHEDULE || "*/30 * * * *",
    },
    exportRetention: {
      enabled: boolFromEnv(process.env.CRON_EXPORT_RETENTION_ENABLED),
      schedule: process.env.CRON_EXPORT_RETENTION_SCHEDULE || "0 3 * * *",
    },
    aiSessionLifecycle: {
      enabled: boolFromEnv(process.env.CRON_AI_SESSION_LIFECYCLE_ENABLED),
      schedule: process.env.CRON_AI_SESSION_LIFECYCLE_SCHEDULE || "0 3 * * *",
    },
    // Member photo media pipeline (both are no-ops while the media pipeline is
    // disabled, so they are safe to leave on). See jobs/mediaCleanupJobs.js.
    mediaOrphanCleanup: {
      enabled: boolFromEnv(process.env.CRON_MEDIA_ORPHAN_CLEANUP_ENABLED),
      // Unreferenced objects are only removed once they are older than the
      // 24h safety window (MEDIA_ORPHAN_GRACE_HOURS), so the cadence below is
      // safe even for uploads that are still in flight.
      schedule: process.env.CRON_MEDIA_ORPHAN_CLEANUP_SCHEDULE || "10 4 * * *", // 04:10 IST
    },
    mediaPhotoRetention: {
      enabled: boolFromEnv(process.env.CRON_MEDIA_RETENTION_ENABLED),
      // Photos replaced by a newer one are kept for
      // MEDIA_PREVIOUS_RETENTION_DAYS (default 14) before removal.
      schedule: process.env.CRON_MEDIA_RETENTION_SCHEDULE || "20 4 * * *", // 04:20 IST
    },
  },
};

export default CRON_CONFIG;
