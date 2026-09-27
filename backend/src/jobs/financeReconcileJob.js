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
// Multi-branch: the service itself iterates Branch.find({ isActive: true }),
// so the cron needs no per-branch loop — it passes an optional branchId only
// when an admin triggers a single-branch on-demand run. Errors are isolated
// per branch and per day inside `reconcileDailySummaries`.
import { reconcileDailySummaries } from "../services/summaryService.js";
import { CRON_CONFIG } from "../config/cronConfig.js";
import logger from "../core/logger.js";

/**
 * Run the reconciliation over the configured (or overridden) window.
 *
 * @param {object} [overrides]
 * @param {number} [overrides.lookbackDays] - days per branch, today inclusive.
 * @param {number} [overrides.driftAlertThreshold] - delta above which a
 *   correction is reported as drift.
 * @param {string|null} [overrides.branchId] - restrict to ONE branch
 *   (admin on-demand path); omit to run for every active branch (cron path).
 * @returns {Promise<object>} audit report:
 *   { startedAt, completedAt, lookbackDays, branchesProcessed, processedDays,
 *     driftDetectedCount, createdCount, totalDrift, details[], errors[] }
 */
export async function executeFinanceReconciliation(overrides = {}) {
  const defaults = CRON_CONFIG.jobs.financialReconciliation;

  const report = await reconcileDailySummaries({
    lookbackDays: overrides.lookbackDays ?? defaults.lookbackDays,
    driftAlertThreshold: overrides.driftAlertThreshold ?? defaults.driftAlertThreshold,
    branchId: overrides.branchId ?? null,
  });

  logger.info("Financial reconciliation finished", {
    branchesProcessed: report.branchesProcessed,
    processedDays: report.processedDays,
    driftDetected: report.driftDetectedCount,
    totalDrift: report.totalDrift,
    failedDays: report.errors.length,
  });

  return report;
}

export default executeFinanceReconciliation;
