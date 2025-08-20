// controllers/paymentController.js - Payment and finance operations
import paymentRepository from "../repositories/paymentRepository.js";
import memberRepository from "../repositories/memberRepository.js";
import { auditActions } from "../utils/auditLog.js";
import { asyncHandler, ValidationError, NotFoundError } from "../core/errorHandler.js";
import PaymentLog from "../models/PaymentLog.js";
import FinanceLog from "../models/FinanceLog.js";
import DailySummary from "../models/DailySummary.js";
import Member from "../models/Member.js";
import { updateTodaySummary } from "../services/summaryService.js";

const toPlainObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject();
  if (value instanceof Map) return Object.fromEntries(value.entries());
  return value;
};

const normalizeSummaryPayload = (summary, logs = []) => {
  const summaryObj = toPlainObject(summary);
  return {
    totalAmount: Number(summaryObj.totalRevenue || 0),
    newVsRenew: {
      new: Number(summaryObj.newJoiningRevenue || 0),
      renewal: Number(summaryObj.renewalRevenue || 0),
    },
    logs,
    plans: toPlainObject(summaryObj.incomeByPlan),
    trainingTypes: toPlainObject(summaryObj.incomeByTrainingType),
    memberCountsByTraining: toPlainObject(summaryObj.membersByTrainingType),
  };
};

const buildDateRange = (query = {}) => {
  const from = query.from || query.startDate;
  const to = query.to || query.endDate;
  if (!from || !to) return null;
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
};

const getTodayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

export const paymentController = {
  // Record a payment
  recordPayment: asyncHandler(async (req, res) => {
    const { gymId, name, plan, trainingType, amount, paymentMode, dietId, dietName } = req.body;

    if (!gymId || !name || !plan || !trainingType || !amount || !paymentMode) {
      throw new ValidationError("Missing required fields");
    }

    // Create finance log
    const financeLog = await paymentRepository.createFinance({
      gymId: Number(gymId),
      memberName: name,
      amount: Number(amount),
      plan,
      trainingType,
      type: "new",
      date: new Date(),
    });

    // Create payment log
    const paymentLog = await paymentRepository.createPayment({
      gymId: Number(gymId),
      name,
      plan,
      trainingType,
      amount: Number(amount),
      paymentMode,
      paidAt: new Date(),
      type: "new",
      dietId: dietId || null,
      dietName: dietName || null,
    });

    // Update daily summary
    await updateTodaySummary(financeLog);

    // Audit log
    await auditActions.paymentCreated(req, paymentLog._id, Number(amount));

    return res.status(201).json({
      success: true,
      message: "Payment recorded successfully",
      data: {
        paymentLog,
        financeLog,
      },
    });
  }),

  // Get payments with filters
  getPayments: asyncHandler(async (req, res) => {
    const { page = 1, pageSize = 10, gymId, startDate, endDate } = req.query;

    const filters = {};
    if (gymId) filters.gymId = Number(gymId);

    if (startDate && endDate) {
      const result = await paymentRepository.findPaymentsByDateRange(
        new Date(startDate),
        new Date(endDate),
        filters
      );
      return res.json({
        success: true,
        data: result,
        count: result.length,
      });
    }

    const result = await paymentRepository.getPaginatedPayments(
      Number(page),
      Number(pageSize),
      filters
    );

    return res.json({
      success: true,
      ...result,
    });
  }),

  // Get payment by ID
  getPaymentById: asyncHandler(async (req, res) => {
    const payment = await paymentRepository.findPaymentById(req.params.id);

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    return res.json({
      success: true,
      data: payment,
    });
  }),

  // Get payments by member
  getPaymentsByMember: asyncHandler(async (req, res) => {
    const { gymId } = req.params;

    const payments = await paymentRepository.findPaymentsByMember(Number(gymId));

    return res.json({
      success: true,
      data: payments,
      count: payments.length,
    });
  }),

  // Get revenue metrics
  getRevenueMetrics: asyncHandler(async (req, res) => {
    const range = buildDateRange(req.query) || getTodayRange();

    const metrics = await paymentRepository.getRevenueMetrics(
      range.start,
      range.end
    );

    return res.json({
      success: true,
      data: metrics,
    });
  }),

  // Get total revenue
  getTotalRevenue: asyncHandler(async (req, res) => {
    const range = buildDateRange(req.query) || getTodayRange();

    const revenue = await paymentRepository.getTotalRevenue(
      range.start,
      range.end
    );

    return res.json({
      success: true,
      data: revenue,
    });
  }),

  // Get revenue by payment mode
  getRevenueByMode: asyncHandler(async (req, res) => {
    const range = buildDateRange(req.query) || getTodayRange();

    const revenue = await paymentRepository.getRevenueByMode(
      range.start,
      range.end
    );

    return res.json({
      success: true,
      data: revenue,
    });
  }),

  // Dashboard: Today's summary payload
  getTodayDashboardSummary: asyncHandler(async (req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [summary, logs] = await Promise.all([
      DailySummary.findOne({ date: today }),
      FinanceLog.find({ date: { $gte: today, $lt: tomorrow } }).sort({ date: -1 }).lean(),
    ]);

    const payload = normalizeSummaryPayload(summary || {}, logs);
    return res.json({ success: true, data: payload });
  }),

  // Dashboard: Custom range report payload
  getIncomeSummaryByDateRange: asyncHandler(async (req, res) => {
    const range = buildDateRange(req.query);
    if (!range) {
      throw new ValidationError("from/to or startDate/endDate are required in YYYY-MM-DD format");
    }

    const { start, end } = range;
    const logs = await FinanceLog.find({ date: { $gte: start, $lte: end } }).sort({ date: -1 }).lean();

    const payload = {
      totalAmount: 0,
      newVsRenew: { new: 0, renewal: 0 },
      logs,
      plans: {},
      trainingTypes: {},
      memberCountsByTraining: {},
    };

    logs.forEach((log) => {
      const amount = Number(log.amount || 0);
      payload.totalAmount += amount;
      if (log.type === "new") payload.newVsRenew.new += amount;
      if (log.type === "renew" || log.type === "renewal") payload.newVsRenew.renewal += amount;
      if (log.plan) payload.plans[log.plan] = Number(payload.plans[log.plan] || 0) + amount;
      if (log.trainingType) {
        payload.trainingTypes[log.trainingType] = Number(payload.trainingTypes[log.trainingType] || 0) + amount;
      }
    });

    const memberCountAgg = await Member.aggregate([
      {
        $match: {
          paymentStatus: "paid",
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: "$trainingType",
          count: { $sum: 1 },
        },
      },
    ]);

    memberCountAgg.forEach((entry) => {
      if (entry._id) {
        payload.memberCountsByTraining[entry._id] = entry.count;
      }
    });

    return res.json({ success: true, data: payload });
  }),

  // Dashboard chart: Age buckets
  getAgeDistribution: asyncHandler(async (req, res) => {
    const range = buildDateRange(req.query);
    const matchStage = {};
    if (range) {
      matchStage.createdAt = { $gte: range.start, $lte: range.end };
    }

    const ageDistribution = await Member.aggregate([
      { $match: matchStage },
      { $match: { dob: { $type: "date" } } },
      {
        $addFields: {
          age: {
            $floor: {
              $divide: [{ $subtract: [new Date(), "$dob"] }, 365.25 * 24 * 60 * 60 * 1000],
            },
          },
        },
      },
      {
        $bucket: {
          groupBy: "$age",
          boundaries: [0, 18, 25, 35, 45, 60, 120],
          default: "Unknown",
          output: { count: { $sum: 1 } },
        },
      },
    ]);

    const labeled = ageDistribution.map((entry) => {
      if (entry._id === "Unknown") {
        return { ageRange: "Unknown", count: entry.count };
      }
      const nextBoundary =
        entry._id === 0 ? "17" : entry._id === 18 ? "24" : entry._id === 25 ? "34" : entry._id === 35 ? "44" : entry._id === 45 ? "59" : "120+";
      return { ageRange: `${entry._id}-${nextBoundary}`, count: entry.count };
    });

    return res.json({ success: true, data: labeled });
  }),

  // Dashboard chart: Payment mode contribution
  getSourceContribution: asyncHandler(async (req, res) => {
    const range = buildDateRange(req.query);
    const matchStage = {};
    if (range) {
      matchStage.paidAt = { $gte: range.start, $lte: range.end };
    }

    const contribution = await PaymentLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$paymentMode",
          value: { $sum: "$amount" },
        },
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          value: 1,
        },
      },
    ]);

    return res.json({ success: true, data: contribution });
  }),

  // Dashboard chart: Plan contribution
  getPlanDistribution: asyncHandler(async (req, res) => {
    const range = buildDateRange(req.query);
    const matchStage = {};
    if (range) {
      matchStage.date = { $gte: range.start, $lte: range.end };
    }

    const distribution = await FinanceLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$plan",
          value: { $sum: "$amount" },
        },
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          value: 1,
        },
      },
    ]);

    return res.json({ success: true, data: distribution });
  }),

  // Refund a payment
  refundPayment: asyncHandler(async (req, res) => {
    const { paymentId, refundAmount, reason } = req.body;

    if (!paymentId || !refundAmount) {
      throw new ValidationError("paymentId and refundAmount are required");
    }

    const payment = await paymentRepository.findPaymentById(paymentId);

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    if (refundAmount > payment.amount) {
      throw new ValidationError("Refund amount cannot exceed original payment amount");
    }

    // Update payment log (add refund record)
    await PaymentLog.create({
      gymId: payment.gymId,
      name: payment.name,
      plan: payment.plan,
      trainingType: payment.trainingType,
      amount: -refundAmount, // Negative for refund
      paymentMode: payment.paymentMode,
      paidAt: new Date(),
      type: "refund",
      reason,
    });

    // Audit log
    await auditActions.paymentRefunded(req, paymentId, refundAmount);

    return res.json({
      success: true,
      message: "Refund processed successfully",
      data: {
        paymentId,
        refundAmount,
        reason,
      },
    });
  }),

  // Get finance logs
  getFinanceLogs: asyncHandler(async (req, res) => {
    const { page = 1, pageSize = 10, startDate, endDate } = req.query;

    const filters = {};

    if (startDate && endDate) {
      const logs = await paymentRepository.findByDateRange(
        new Date(startDate),
        new Date(endDate),
        filters
      );
      return res.json({
        success: true,
        data: logs,
        count: logs.length,
      });
    }

    const skip = (page - 1) * pageSize;
    const logs = await paymentRepository.findAllFinance(filters, {
      skip,
      limit: Number(pageSize),
    });
    const total = await FinanceLog.countDocuments(filters);

    return res.json({
      success: true,
      data: logs,
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  }),

  // Delete payment
  deletePayment: asyncHandler(async (req, res) => {
    const payment = await paymentRepository.deletePayment(req.params.id);

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    return res.json({
      success: true,
      message: "Payment deleted successfully",
    });
  }),
};

export default paymentController;
