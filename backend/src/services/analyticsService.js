import PaymentLog from "../models/PaymentLog.js";
import Member from "../models/Member.js";
import Package from "../models/Package.js";
import logger from "../core/logger.js";

class AnalyticsService {
  /**
   * Get aggregated analytics metrics for a date range
   * Reusable by both Dashboard API and PDF export
   */
  async getAnalyticsMetrics(startDate, endDate) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const filters = {
        paidAt: {
          $gte: start,
          $lte: end,
        },
      };

      // Total Revenue & Transactions
      const totalStats = await PaymentLog.aggregate([
        { $match: filters },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$amount" },
            totalTransactions: { $sum: 1 },
          },
        },
      ]);

      // Revenue by Transaction Type
      const revenueByType = await PaymentLog.aggregate([
        { $match: filters },
        {
          $group: {
            _id: "$type", // 'new' or 'renewal'
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]);

      // Revenue by Package/Plan
      const revenueByPlan = await PaymentLog.aggregate([
        { $match: filters },
        {
          $group: {
            _id: "$plan",
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]);

      // Revenue by Training Type
      const revenueByTrainingType = await PaymentLog.aggregate([
        { $match: filters },
        {
          $group: {
            _id: "$trainingType",
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]);

      // Parse results
      const [total] = totalStats;
      const newRevenue = revenueByType.find((r) => r._id === "new") || {};
      const renewalRevenue = revenueByType.find((r) => r._id === "renewal") || {};

      return {
        period: {
          startDate: startDate,
          endDate: endDate,
        },
        totalRevenue: total?.totalRevenue || 0,
        totalTransactions: total?.totalTransactions || 0,
        newJoiningRevenue: newRevenue?.amount || 0,
        renewalRevenue: renewalRevenue?.amount || 0,
        incomeByPlan: revenueByPlan.map((r) => ({
          planName: r._id || "Unknown",
          amount: r.amount || 0,
          count: r.count || 0,
        })),
        incomeByTrainingType: revenueByTrainingType.map((r) => ({
          trainingType: r._id || "Unknown",
          amount: r.amount || 0,
          count: r.count || 0,
        })),
      };
    } catch (error) {
      logger.error("Analytics metrics error:", error);
      throw error;
    }
  }
}

export default new AnalyticsService();
