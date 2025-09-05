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
export async function getTodaySummary() {
  try {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0); // Start of day (00:00:00)

    // Try to find existing summary
    let summary = await DailySummary.findOne({ date: today });

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
      await summary.save();
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
export async function updateTodaySummary(transactionLog) {
  try {
    const summary = await getTodaySummary();

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
    const updated = await DailySummary.findByIdAndUpdate(
      summary._id,
      updateOps,
      { new: true } // Return updated document
    );

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
 * Recalculates today's summary from scratch
 * Use if summary gets corrupted or out of sync
 * 
 * Process:
 * 1. Fetch all FinanceLog transactions for today
 * 2. Aggregate manually (sum amounts, group by plan/type)
 * 3. Upsert new summary
 * 4. Replace old summary
 * 
 * Note: This is SLOWER than atomic updates (full table scan)
 * Only use for recovery, not in normal operation
 */
export async function rebuildTodaySummary() {
  try {
    logger.info("🔨 Rebuilding today's summary from FinanceLog...");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // ========== STEP 1: Fetch today's transactions ==========
    const transactions = await FinanceLog.find({
      date: { $gte: today, $lt: tomorrow },
    });

    logger.info(`   Found ${transactions.length} transactions for today`);

    // ========== STEP 2: Initialize aggregation variables ==========
    let totalRevenue = 0;
    let newRevenue = 0;
    let renewalRevenue = 0;
    const incomeByPlan = new Map();
    const incomeByTrainingType = new Map();

    // ========== STEP 3: Loop through transactions to aggregate ==========
    for (const tx of transactions) {
      const amount = Number(tx.amount) || 0;

      // Total
      totalRevenue += amount;

      // Revenue by type (new vs renewal)
      if (tx.type === "new") {
        newRevenue += amount;
      } else if (tx.type === "renew") {
        renewalRevenue += amount;
      }

      // Revenue by plan
      const plan = tx.plan || "Unknown";
      incomeByPlan.set(plan, (incomeByPlan.get(plan) || 0) + amount);

      // Revenue by training type
      const trainingType = tx.trainingType || "Unknown";
      incomeByTrainingType.set(
        trainingType,
        (incomeByTrainingType.get(trainingType) || 0) + amount
      );
    }

    // ========== STEP 4: Get member count by training type for today ==========
    const memberCountAgg = await Member.aggregate([
      {
        $match: {
          paymentStatus: "paid",
          createdAt: { $gte: today, $lt: tomorrow },
        },
      },
      {
        $group: {
          _id: "$trainingType",
          count: { $sum: 1 },
        },
      },
    ]);

    const membersByTrainingType = new Map();
    memberCountAgg.forEach((m) => {
      membersByTrainingType.set(m._id || "Unknown", m.count);
    });

    // ========== STEP 5: Upsert summary ==========
    const summary = await DailySummary.findOneAndUpdate(
      { date: today },
      {
        totalRevenue,
        newJoiningRevenue: newRevenue,
        renewalRevenue,
        totalTransactions: transactions.length,
        incomeByPlan,
        incomeByTrainingType,
        membersByTrainingType,
        lastUpdatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    logger.info("✅ Summary rebuilt:");
    logger.info(`   Total: ₹${totalRevenue}`);
    logger.info(`   New: ₹${newRevenue} | Renewal: ₹${renewalRevenue}`);
    logger.info(`   Transactions: ${transactions.length}`);

    return summary;
  } catch (err) {
    logger.error("❌ Error rebuilding summary:", err.message);
    throw err;
  }
}

/**
 * Rebuilds last 7 days of summaries
 * Use if corrupted multiple days or need historical consistency
 * 
 * WARNING: Expensive operation, runs full scans for 7 days
 * Only execute during off-peak hours
 */
export async function rebuildLastSevenDays() {
  try {
    logger.info("🔨 Rebuilding last 7 days of summaries...");

    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const dateStr = date.toISOString().split('T')[0];
      logger.info(`   Processing ${dateStr}...`);

      const tomorrow = new Date(date);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Fetch transactions
      const transactions = await FinanceLog.find({
        date: { $gte: date, $lt: tomorrow },
      });

      // Aggregate
      let totalRevenue = 0;
      let newRevenue = 0;
      let renewalRevenue = 0;
      const incomeByPlan = new Map();
      const incomeByTrainingType = new Map();

      for (const tx of transactions) {
        const amount = Number(tx.amount) || 0;
        totalRevenue += amount;

        if (tx.type === "new") newRevenue += amount;
        if (tx.type === "renew") renewalRevenue += amount;

        const plan = tx.plan || "Unknown";
        incomeByPlan.set(plan, (incomeByPlan.get(plan) || 0) + amount);

        const trainingType = tx.trainingType || "Unknown";
        incomeByTrainingType.set(
          trainingType,
          (incomeByTrainingType.get(trainingType) || 0) + amount
        );
      }

      // Upsert
      await DailySummary.findOneAndUpdate(
        { date },
        {
          totalRevenue,
          newJoiningRevenue: newRevenue,
          renewalRevenue,
          totalTransactions: transactions.length,
          incomeByPlan,
          incomeByTrainingType,
        },
        { upsert: true }
      );

      logger.info(`      ✓ ${dateStr}: ₹${totalRevenue} from ${transactions.length} transactions`);
    }

    logger.info("✅ 7-day rebuild complete");
  } catch (err) {
    logger.error("❌ Error in 7-day rebuild:", err.message);
    throw err;
  }
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
