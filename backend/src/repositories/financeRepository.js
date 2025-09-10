// repositories/financeRepository.js - Data access layer for finance
import FinanceLog from "../models/FinanceLog.js";
import DailySummary from "../models/DailySummary.js";

class FinanceRepository {
  // ============= FINANCE LOG METHODS =============

  // Find finance log by ID
  async findById(id) {
    return FinanceLog.findById(id);
  }

  // Find all finance logs
  async findAll(filters = {}, options = {}) {
    const { skip = 0, limit = 100, sort = { createdAt: -1 } } = options;
    const query = FinanceLog.find(filters);

    if (sort) query.sort(sort);
    if (skip) query.skip(skip);
    if (limit) query.limit(limit);

    return query;
  }

  // Count finance logs
  async count(filters = {}) {
    return FinanceLog.countDocuments(filters);
  }

  // Create finance log
  async create(financeData) {
    const finance = new FinanceLog(financeData);
    return finance.save();
  }

  // Update finance log
  async update(id, updateData) {
    return FinanceLog.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });
  }

  // Delete finance log
  async delete(id) {
    return FinanceLog.findByIdAndDelete(id);
  }

  // Find logs by date range
  async findByDateRange(startDate, endDate, filters = {}) {
    return FinanceLog.find({
      ...filters,
      createdAt: { $gte: startDate, $lte: endDate },
    }).sort({ createdAt: -1 });
  }

  // Get revenue by training type
  async getRevenueByType(startDate, endDate) {
    return FinanceLog.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: "$trainingType",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
          average: { $avg: "$amount" },
        },
      },
    ]);
  }

  // Get revenue by plan duration
  async getRevenueByPlan(startDate, endDate) {
    return FinanceLog.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: "$plan",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);
  }

  // Get total revenue
  async getTotalRevenue(startDate, endDate) {
    const result = await FinanceLog.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    return result[0] || { total: 0, count: 0 };
  }

  // Get paginated finance logs
  async getPaginated(page = 1, pageSize = 10, filters = {}) {
    const skip = (page - 1) * pageSize;
    const logs = await this.findAll(filters, {
      skip,
      limit: pageSize,
      sort: { createdAt: -1 },
    });
    const total = await this.count(filters);

    return {
      data: logs,
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    };
  }

  // ============= DAILY SUMMARY METHODS =============

  // Get summary for date
  async findSummaryByDate(date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return DailySummary.findOne({
      date: { $gte: startOfDay, $lte: endOfDay },
    });
  }

  // Create or update daily summary
  async upsertSummary(date, summaryData) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return DailySummary.findOneAndUpdate(
      { date: { $gte: startOfDay, $lte: endOfDay } },
      { ...summaryData, date },
      { new: true, upsert: true, runValidators: true }
    );
  }

  // Find summaries by date range
  async findSummariesByRange(startDate, endDate) {
    return DailySummary.find({
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: -1 });
  }

  // Get latest summary
  async getLatestSummary() {
    return DailySummary.findOne().sort({ date: -1 });
  }

  // Delete summary
  async deleteSummary(id) {
    return DailySummary.findByIdAndDelete(id);
  }
}

export default new FinanceRepository();
