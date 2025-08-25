// controllers/analyticsController.js - Analytics and reporting
import analyticsService from "../services/analyticsService.js";
import PDFGenerator from "../utils/pdfGenerator.js";
import { asyncHandler, ValidationError } from "../core/errorHandler.js";

export const analyticsController = {
  // Get analytics metrics
  getMetrics: asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    // Default to today if not provided
    const start = startDate || new Date().toISOString().split("T")[0];
    const end = endDate || new Date().toISOString().split("T")[0];

    const metrics = await analyticsService.getAnalyticsMetrics(start, end);

    return res.json({
      success: true,
      data: metrics,
    });
  }),

  // Export analytics as PDF
  exportPDF: asyncHandler(async (req, res) => {
    const startDate = req.query.startDate || req.body.startDate;
    const endDate = req.query.endDate || req.body.endDate;
    const format = req.query.format || req.body.format || "pdf";

    if (format !== "pdf") {
      throw new ValidationError("Format not supported");
    }

    const start = startDate || new Date().toISOString().split("T")[0];
    const end = endDate || new Date().toISOString().split("T")[0];

    const metrics = await analyticsService.getAnalyticsMetrics(start, end);

    // Generate PDF
    const pdfBuffer = await PDFGenerator.generateAnalyticsPDF(metrics);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="analytics-${start}-to-${end}.pdf"`
    );
    res.send(pdfBuffer);
  }),

  // Get member statistics
  getMemberStatistics: asyncHandler(async (req, res) => {
    const stats = await analyticsService.getMemberStatistics();

    return res.json({
      success: true,
      data: stats,
    });
  }),

  // Get revenue statistics
  getRevenueStatistics: asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new ValidationError("startDate and endDate are required");
    }

    const stats = await analyticsService.getRevenueStatistics(
      new Date(startDate),
      new Date(endDate)
    );

    return res.json({
      success: true,
      data: stats,
    });
  }),

  // Get membership trends
  getMembershipTrends: asyncHandler(async (req, res) => {
    const { days = 30 } = req.query;

    const trends = await analyticsService.getMembershipTrends(Number(days));

    return res.json({
      success: true,
      data: trends,
    });
  }),

  // Get active members count
  getActiveMembersCount: asyncHandler(async (req, res) => {
    const count = await analyticsService.getActiveMembersCount();

    return res.json({
      success: true,
      data: {
        activeMembers: count,
      },
    });
  }),

  // Get expiring members
  getExpiringMembers: asyncHandler(async (req, res) => {
    const { days = 7 } = req.query;

    const members = await analyticsService.getExpiringMembers(Number(days));

    return res.json({
      success: true,
      data: members,
      count: members.length,
    });
  }),

  // Get revenue by package
  getRevenueByPackage: asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new ValidationError("startDate and endDate are required");
    }

    const data = await analyticsService.getRevenueByPackage(
      new Date(startDate),
      new Date(endDate)
    );

    return res.json({
      success: true,
      data,
    });
  }),

  // Get revenue by training type
  getRevenueByTrainingType: asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new ValidationError("startDate and endDate are required");
    }

    const data = await analyticsService.getRevenueByTrainingType(
      new Date(startDate),
      new Date(endDate)
    );

    return res.json({
      success: true,
      data,
    });
  }),

  // Get payment mode distribution
  getPaymentModeDistribution: asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new ValidationError("startDate and endDate are required");
    }

    const data = await analyticsService.getPaymentModeDistribution(
      new Date(startDate),
      new Date(endDate)
    );

    return res.json({
      success: true,
      data,
    });
  }),

  // Get dashboard summary
  getDashboardSummary: asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();

    const summary = await analyticsService.getDashboardSummary(start, end);

    return res.json({
      success: true,
      data: summary,
    });
  }),
};

export default analyticsController;
