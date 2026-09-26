/**
 * Summary Service: Manages daily financial summary updates
 * 
 * Key Functions:
 * - getTodaySummary(): Get or create today's summary
 * - updateTodaySummary(): Atomically add transaction to summary
 * - rebuildTodaySummary(): Recalculate from FinanceLog (rebuild after corruption)
 * - markPreviousDayComplete(): Lock yesterday's data (immutable)
 * 
 * Usage:
 * ------
 * import { updateTodaySummary } from "../services/summaryService.js";
 * 
 * // After creating transaction
 * await updateTodaySummary(financeLogEntry);
 */

import DailySummary from "../models/DailySummary.js";
import FinanceLog from "../models/FinanceLog.js";
import Member from "../models/Member.js";
import logger from "../core/logger.js";

/**
 * Gets today's summary, creating if not exists
 * Called when: Dashboard loads, transaction created, or check period
 * 
 * Returns: DailySummary document for today
 */
export async function getTodaySummary(session = null) {
  try {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0); // Start of day (00:00:00)

    // Try to find existing summary
    let summary = session
      ? await DailySummary.findOne({ date: today }).session(session)
      : await DailySummary.findOne({ date: today });

    // If not found, create new summary for today
    if (!summary) {
      summary = new DailySummary({
        date: today,
        totalRevenue: 0,
        newJoiningRevenue: 0,
        renewalRevenue: 0,
        totalTransactions: 0,
        incomeByPlan: new Map(),
        incomeByTrainingType: new Map(),
        membersByTrainingType: new Map(),
      });
      await (session ? summary.save({ session }) : summary.save());
      logger.info("📊 Created new daily summary for", today.toISOString().split('T')[0]);
    }

    return summary;
  } catch (err) {
    logger.error("❌ Error in getTodaySummary:", err.message);
    throw err;
  }
}

/**
 * Updates today's summary with a new transaction
 * ATOMIC UPDATE: Increments values without full recalculation
 * 
 * Called when:
 * - New member registers (type="new")
 * - Member renewal (type="renew")
 * - Manual transaction added
 * 
 * @param {Object} transactionLog - FinanceLog document with fields:
 *   - amount: transaction amount
 *   - type: "new" or "renew"
 *   - plan: package plan (e.g., "1 Month", "3 Months")
 *   - trainingType: training type (e.g., "Weight Loss", "Weight Gain")
 */
export async function updateTodaySummary(transactionLog, session = null) {
  try {
    const summary = await getTodaySummary(session);

    const amount = Number(transactionLog.amount) || 0;
    const plan = transactionLog.plan || "Unknown";
    const trainingType = transactionLog.trainingType || "Unknown";
    const type = transactionLog.type || "new";

    // ==================== ATOMIC UPDATE ====================
    // MongoDB $inc: increments values atomically
    // MongoDB $set: updates single field
    // This prevents race conditions when multiple transactions arrive simultaneously

    const updateOps = {
      $inc: {
        // Total increments
        totalRevenue: amount,
        totalTransactions: 1,
      },
      $set: {
        lastUpdatedAt: new Date(),
      },
    };

    // ========== Add to revenue column (new vs renewal) ==========
    if (type === "new") {
      updateOps.$inc.newJoiningRevenue = amount;
    } else if (type === "renew") {
      updateOps.$inc.renewalRevenue = amount;
    }

    // ========== Breakdown by plan ==========
    // MongoDB allows dynamic map keys using dot notation
    // Format: incomeByPlan.{plan}: {amount}
    updateOps.$inc[`incomeByPlan.${plan}`] = amount;

    // ========== Breakdown by training type ==========
    updateOps.$inc[`incomeByTrainingType.${trainingType}`] = amount;

    // Execute update
    const updated = session
      ? await DailySummary.findByIdAndUpdate(summary._id, updateOps, { new: true, session })
      : await DailySummary.findByIdAndUpdate(summary._id, updateOps, { new: true });

    logger.info(`📈 Summary updated: +₹${amount} (${type}) | Total: ₹${updated.totalRevenue}`);
    return updated;
  } catch (err) {
    logger.error("❌ Error updating summary:", err.message);
    throw err;
  }
}

/**
 * Marks yesterday's summary as completed (immutable)
 * After midnight, yesterday's data shouldn't change
 * 
 * Called at: Midnight, or app startup (checks if date changed)
 * 
 * Why lock yesterday?
 * - Prevents accidental edits to historical data
 * - Ensures consistency for reporting
 * - Allows safe archival/backup
 */
export async function markPreviousDayComplete() {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const result = await DailySummary.findOneAndUpdate(
      { date: yesterday },
      { isCompleted: true },
      { upsert: false } // Don't create if doesn't exist
    );

    if (result) {
      logger.info(`🔒 Locked yesterday's summary (${yesterday.toISOString().split('T')[0]})`);
    }

    return result;
  } catch (err) {
    logger.error("❌ Error locking yesterday:", err.message);
    throw err;
  }
}

/**
 * Business-day boundary helpers.
 *
 * Day boundaries are computed in the PROCESS timezone, which server.js pins to
 * `config.cron.timezone` (Asia/Kolkata) as its very first statement. Anything
 * that imports this service without booting server.js — notably the test suite
 * — must set `process.env.TZ` itself, or windows will silently be computed in
 * the host timezone.
 */

/** Midnight (business timezone) of the day containing targetDate. */
export function startOfDay(targetDate = new Date()) {
  const start = new Date(targetDate);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Half-open [start, nextDay) window for the business day containing targetDate. */
export function dayWindow(targetDate = new Date()) {
  const start = startOfDay(targetDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * YYYY-MM-DD of the business day, formatted from LOCAL parts.
 *
 * Deliberately not `toISOString().slice(0, 10)`: an IST midnight is 18:30 UTC
 * the previous day, so the ISO form would label every day one day early.
 */
export function businessDateKey(targetDate = new Date()) {
  const { start } = dayWindow(targetDate);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, '0');
  const d = String(start.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Recompute ONE business day's DailySummary from the source records.
 *
 * This is the single rebuild primitive — `rebuildTodaySummary`,
 * `rebuildLastSevenDays` and the nightly reconciliation all delegate here, so
 * a fix to the aggregation only ever has to be made once.
 *
 * Rebuilds every derived field, including `membersByTrainingType` and
 * `lastUpdatedAt` (both of which the previous 7-day rebuild silently omitted).
 *
 * @param {Date|string|number} targetDate - any instant inside the target day.
 * @returns {Promise<Object>} the upserted DailySummary document.
 */
export async function rebuildSummaryForDate(targetDate = new Date()) {
  const { start, end } = dayWindow(targetDate);
  const dateKey = businessDateKey(start);

  const transactions = await FinanceLog.find({ date: { $gte: start, $lt: end } });

  let totalRevenue = 0;
  let newRevenue = 0;
  let renewalRevenue = 0;
  const incomeByPlan = new Map();
  const incomeByTrainingType = new Map();

  for (const tx of transactions) {
    const amount = Number(tx.amount) || 0;
    totalRevenue += amount;

    if (tx.type === 'new') newRevenue += amount;
    else if (tx.type === 'renew') renewalRevenue += amount;

    const plan = tx.plan || 'Unknown';
    incomeByPlan.set(plan, (incomeByPlan.get(plan) || 0) + amount);

    const trainingType = tx.trainingType || 'Unknown';
    incomeByTrainingType.set(
      trainingType,
      (incomeByTrainingType.get(trainingType) || 0) + amount
    );
  }

  // Member counts are derived from Member.createdAt (registration time), NOT
  // from FinanceLog — a renewal must not inflate the "members joined" count.
  const memberCountAgg = await Member.aggregate([
    { $match: { paymentStatus: 'paid', createdAt: { $gte: start, $lt: end } } },
    { $group: { _id: '$trainingType', count: { $sum: 1 } } },
  ]);

  const membersByTrainingType = new Map();
  for (const entry of memberCountAgg) {
    membersByTrainingType.set(entry._id || 'Unknown', entry.count);
  }

  logger.info(
    `Rebuilding ${dateKey}: ${transactions.length} transactions, ` +
    `revenue ${totalRevenue}, ${memberCountAgg.length} training types`
  );

  return DailySummary.findOneAndUpdate(
    { date: start },
    {
      $set: {
        totalRevenue,
        newJoiningRevenue: newRevenue,
        renewalRevenue,
        totalTransactions: transactions.length,
        incomeByPlan,
        incomeByTrainingType,
        membersByTrainingType,
        lastUpdatedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
}

/**
 * Recalculates a summary from scratch (defaults to today).
 * Back-compatible wrapper — use rebuildSummaryForDate for a specific day.
 */
export async function rebuildTodaySummary(targetDate = new Date()) {
  return rebuildSummaryForDate(targetDate);
}

/**
 * Rebuilds the last `days` business days (today inclusive).
 *
 * Each day is isolated: a failure on one date is recorded and the remaining
 * days still run, so a single bad day can never leave the week half-rebuilt
 * with no record of which days completed.
 *
 * @param {number} days - lookback window size, default 7.
 * @returns {Promise<Array<{date:string, ok:boolean, totalRevenue?:number, error?:string}>>}
 */
export async function rebuildLastSevenDays(days = 7) {
  const results = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const target = new Date();
    target.setDate(target.getDate() - i);
    const dateKey = businessDateKey(target);

    try {
      const summary = await rebuildSummaryForDate(target);
      results.push({
        date: dateKey,
        ok: true,
        totalRevenue: Number(summary?.totalRevenue || 0),
      });
    } catch (err) {
      logger.error(`Error rebuilding ${dateKey}:`, err.message);
      results.push({ date: dateKey, ok: false, error: err.message });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  logger.info(`${days}-day rebuild complete: ${ok}/${days} days succeeded`);
  return results;
}

/**
 * Nightly self-healing reconciliation.
 *
 * DailySummary is a denormalised cache maintained by $inc on the write path.
 * Any write that skips `updateTodaySummary` (bulk import, a profile edit, a
 * crash between the ledger write and the increment) leaves it permanently
 * wrong — and the pre-existing rebuild helpers were never invoked by anything.
 * This walks the lookback window, recomputes each day from FinanceLog, and
 * reports exactly what it corrected.
 *
 * Errors are isolated per day. Shared by the nightly cron and the manual admin
 * endpoint so both paths run one implementation.
 *
 * @param {object} options
 * @param {number} options.lookbackDays - days to reconcile, including today.
 * @param {number} options.driftAlertThreshold - absolute delta above which a
 *   correction is reported as drift (guards against float noise).
 * @returns {Promise<object>} audit report.
 */
export async function reconcileDailySummaries({
  lookbackDays = 7,
  driftAlertThreshold = 0.01,
} = {}) {
  const report = {
    startedAt: new Date(),
    lookbackDays,
    processedDays: 0,
    driftDetectedCount: 0,
    createdCount: 0,
    totalDrift: 0,
    details: [],
    errors: [],
  };

  for (let i = lookbackDays - 1; i >= 0; i -= 1) {
    const target = new Date();
    target.setDate(target.getDate() - i);
    const dateKey = businessDateKey(target);

    try {
      const { start } = dayWindow(target);
      const before = await DailySummary.findOne({ date: start }).lean();

      const previousRevenue = Number(before?.totalRevenue || 0);
      const previousTransactions = Number(before?.totalTransactions || 0);

      const summary = await rebuildSummaryForDate(target);

      const newRevenue = Number(summary?.totalRevenue || 0);
      const newTransactions = Number(summary?.totalTransactions || 0);
      const delta = Math.abs(newRevenue - previousRevenue);
      const hasDrift = delta > driftAlertThreshold;

      if (hasDrift) {
        report.driftDetectedCount += 1;
        report.totalDrift += delta;
        logger.warn(
          `Drift reconciled for ${dateKey}: stored ${previousRevenue} -> actual ` +
          `${newRevenue} (delta ${delta}${before ? '' : ', summary was missing'})`
        );
      }
      if (!before) report.createdCount += 1;

      report.details.push({
        date: dateKey,
        hadSummary: Boolean(before),
        previousRevenue,
        newRevenue,
        delta,
        previousTransactions,
        newTransactions,
        hasDrift,
      });
      report.processedDays += 1;
    } catch (err) {
      logger.error(`Reconciliation failed for ${dateKey}:`, err.message);
      report.errors.push({ date: dateKey, error: err.message });
    }
  }

  report.completedAt = new Date();
  logger.info(
    `Financial reconciliation complete: ${report.processedDays} days processed, ` +
    `${report.driftDetectedCount} drifted, ${report.errors.length} failed`
  );
  return report;
}

/**
 * Diagnose summary health
 * Returns info about today's summary
 */
export async function getDiagnostics() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const summary = await DailySummary.findOne({ date: today });

    if (!summary) {
      return { status: "MISSING", message: "No summary for today" };
    }

    const timeSinceUpdate = Date.now() - summary.lastUpdatedAt.getTime();
    const minutesSinceUpdate = Math.floor(timeSinceUpdate / 60000);

    return {
      status: "OK",
      date: today.toISOString().split('T')[0],
      totalRevenue: summary.totalRevenue,
      totalTransactions: summary.totalTransactions,
      lastUpdatedMinutesAgo: minutesSinceUpdate,
      isCompleted: summary.isCompleted,
      plansTracked: summary.incomeByPlan.size,
      trainingTypesTracked: summary.incomeByTrainingType.size,
    };
  } catch (err) {
    return { status: "ERROR", message: err.message };
  }
}

// ============================================================================
// SCHEDULED TASKS
// ============================================================================

/**
 * Initialize midnight reset task
 * Checks every minute if date changed, marks yesterday complete
 * 
 * Call in server.js startup:
 * ──────────────────────────
 * import { initDailyTasks } from "../services/summaryService.js";
 * initDailyTasks();
 */
export function initDailyTasks() {
  let lastCheckDate = new Date().getDate();

  const checkInterval = setInterval(async () => {
    try {
      const now = new Date();
      const currentDate = now.getDate();

      // If date changed, execute midnight task
      if (currentDate !== lastCheckDate) {
        logger.info("🌙 Date changed! Executing midnight tasks...");

        // Mark yesterday as complete
        await markPreviousDayComplete();

        // Initialize today's summary
        await getTodaySummary();

        lastCheckDate = currentDate;
        logger.info("✅ Midnight tasks complete");
      }
    } catch (err) {
      logger.error("❌ Error in daily task:", err.message);
    }
  }, 60000); // Check every minute

  return () => clearInterval(checkInterval);
}
