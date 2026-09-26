// jobs/financeReconcileJob.js — nightly financial reconciliation entry point.
//
// DailySummary is a denormalised cache maintained by $inc on the write path;
// any write that bypasses `updateTodaySummary` leaves it permanently wrong.
// This job recomputes the configured lookback window from FinanceLog and
// reports exactly what it corrected (drift deltas), so the audit trail shows
// both the stored and the actual figure for every day it touched.
//
// One implementation is shared by the nightly cron (server.js) and the manual
// POST /api/finance/reconcile admin endpoint, so both paths behave identically.
// Errors are isolated per day inside `reconcileDailySummaries` — a single bad
// date never aborts the rest of the window.
import { reconcileDailySummaries } from "../services/summaryService.js";
import { CRON_CONFIG } from "../config/cronConfig.js";
import logger from "../core/logger.js";

/**
 * Run the reconciliation over the configured (or overridden) window.
 *
 * @param {object} [overrides]
 * @param {number} [overrides.lookbackDays] - days to reconcile, today inclusive.
 * @param {number} [overrides.driftAlertThreshold] - delta above which a
 *   correction is reported as drift.
 * @returns {Promise<object>} audit report:
 *   { startedAt, completedAt, lookbackDays, processedDays, driftDetectedCount,
 *     createdCount, totalDrift, details[], errors[] }
 */
export async function executeFinanceReconciliation(overrides = {}) {
  const defaults = CRON_CONFIG.jobs.financialReconciliation;

  const report = await reconcileDailySummaries({
    lookbackDays: overrides.lookbackDays ?? defaults.lookbackDays,
    driftAlertThreshold: overrides.driftAlertThreshold ?? defaults.driftAlertThreshold,
  });

  logger.info("Financial reconciliation finished", {
    processedDays: report.processedDays,
    driftDetected: report.driftDetectedCount,
    totalDrift: report.totalDrift,
    failedDays: report.errors.length,
  });

  return report;
}

export default executeFinanceReconciliation;
