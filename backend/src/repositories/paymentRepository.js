// repositories/paymentRepository.js - Data access layer for payments
import mongoose from "mongoose";
import PaymentLog from "../models/PaymentLog.js";
import FinanceLog from "../models/FinanceLog.js";

// Aggregation $match does not run mongoose casting — convert explicitly.
// Returns undefined when branchId is null (internal/cross-branch callers only).
const branchMatch = (branchId) =>
  branchId ? { branchId: new mongoose.Types.ObjectId(String(branchId)) } : {};

class PaymentRepository {
  // ============= PAYMENT LOG METHODS =============

  // Find payment by ID
  async findPaymentById(id) {
    return PaymentLog.findById(id).populate("dietId");
  }

  // Find all payments with filters
  async findAllPayments(filters = {}, options = {}) {
    const { skip = 0, limit = 100, sort = { paidAt: -1 } } = options;
    const query = PaymentLog.find(filters);

    if (sort) query.sort(sort);
    if (skip) query.skip(skip);
    if (limit) query.limit(limit);

    return query.populate("dietId");
  }

  // Count payments
  async countPayments(filters = {}) {
    return PaymentLog.countDocuments(filters);
  }

  // Create payment
  async createPayment(paymentData) {
    const payment = new PaymentLog(paymentData);
    return payment.save();
  }

  // Update payment
  async updatePayment(id, updateData) {
    return PaymentLog.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate("dietId");
  }

  // Delete payment — scoped to one branch when branchId is given, so an
  // admin can never delete another branch's record by id.
  async deletePayment(id, branchId = null) {
    const filter = { _id: id };
    if (branchId) filter.branchId = branchId;
    return PaymentLog.findOneAndDelete(filter);
  }

  // Find payments by member (gym ID) — scoped to one branch when given
  // (gymId can legitimately repeat across branches).
  async findPaymentsByMember(gymId, branchId = null) {
    const filter = { gymId };
    if (branchId) filter.branchId = branchId;
    return PaymentLog.find(filter).sort({ paidAt: -1 }).populate("dietId");
  }

  // Find payments by date range
  async findPaymentsByDateRange(startDate, endDate, filters = {}) {
    return PaymentLog.find({
      ...filters,
      paidAt: { $gte: startDate, $lte: endDate },
    })
      .sort({ paidAt: -1 })
      .populate("dietId");
  }

  // Get revenue metrics (per branch when branchId is given)
  async getRevenueMetrics(startDate, endDate, branchId = null) {
    const payments = await PaymentLog.aggregate([
      {
        $match: {
          paidAt: { $gte: startDate, $lte: endDate },
          ...branchMatch(branchId),
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

    return payments;
  }

  // Get revenue by payment mode (per branch when branchId is given)
  async getRevenueByMode(startDate, endDate, branchId = null) {
    return PaymentLog.aggregate([
      {
        $match: {
          paidAt: { $gte: startDate, $lte: endDate },
          ...branchMatch(branchId),
        },
      },
      {
        $group: {
          _id: "$paymentMode",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);
  }

  // Get total revenue (per branch when branchId is given)
  async getTotalRevenue(startDate, endDate, branchId = null) {
    const result = await PaymentLog.aggregate([
      {
        $match: {
          paidAt: { $gte: startDate, $lte: endDate },
          ...branchMatch(branchId),
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

  // Get paginated payments
  async getPaginatedPayments(page = 1, pageSize = 10, filters = {}) {
    const skip = (page - 1) * pageSize;
    const payments = await this.findAllPayments(filters, {
      skip,
      limit: pageSize,
      sort: { paidAt: -1 },
    });
    const total = await this.countPayments(filters);

    return {
      data: payments,
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    };
  }

  // ============= FINANCE LOG METHODS =============

  // Find finance log by ID
  async findFinanceById(id) {
    return FinanceLog.findById(id);
  }

  // Find all finance logs
  async findAllFinance(filters = {}, options = {}) {
    const { skip = 0, limit = 100, sort = { createdAt: -1 } } = options;
    const query = FinanceLog.find(filters);

    if (sort) query.sort(sort);
    if (skip) query.skip(skip);
    if (limit) query.limit(limit);

    return query;
  }

  // Create finance log
  async createFinance(financeData) {
    const finance = new FinanceLog(financeData);
    return finance.save();
  }

  // Update finance log
  async updateFinance(id, updateData) {
    return FinanceLog.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });
  }

  // Delete finance log
  async deleteFinance(id) {
    return FinanceLog.findByIdAndDelete(id);
  }
}

export default new PaymentRepository();
