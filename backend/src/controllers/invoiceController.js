// controllers/invoiceController.js - Invoice generation and management
import SignedPDFLink from "../models/SignedPDFLink.js";
import Member from "../models/Member.js";
import PDFGenerator from "../utils/pdfGenerator.js";
import { asyncHandler, ValidationError, NotFoundError } from "../core/errorHandler.js";

export const invoiceController = {
  // Generate invoice for member
  generateInvoice: asyncHandler(async (req, res) => {
    const { memberId, paymentDate, amount, plan } = req.body;

    if (!memberId || !amount || !plan) {
      throw new ValidationError("Missing required fields: memberId, amount, plan");
    }

    const member = await Member.findById(memberId);

    if (!member) {
      throw new NotFoundError("Member not found");
    }

    // Generate PDF buffer
    const invoiceData = {
      memberId: member.gymId,
      memberName: member.fullName,
      amount,
      plan,
      date: paymentDate || new Date(),
      trainingType: member.trainingType,
    };

    const pdfBuffer = await PDFGenerator.generateInvoicePDF(invoiceData);

    // Store in signed links collection
    const signedLink = new SignedPDFLink({
      fileName: `invoice-${member.gymId}-${Date.now()}.pdf`,
      pdfBuffer: pdfBuffer,
      memberId: memberId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });

    await signedLink.save();

    return res.json({
      success: true,
      message: "Invoice generated successfully",
      data: {
        linkId: signedLink._id,
        fileName: signedLink.fileName,
      },
    });
  }),

  // Get invoice by link ID
  getInvoiceByLink: asyncHandler(async (req, res) => {
    const { linkId } = req.params;

    const link = await SignedPDFLink.findById(linkId);

    if (!link) {
      throw new NotFoundError("Invoice not found or link expired");
    }

    // Check if expired
    if (link.expiresAt < new Date()) {
      throw new ValidationError("Link has expired");
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${link.fileName}"`);
    res.send(link.pdfBuffer);
  }),

  // List invoices
  listInvoices: asyncHandler(async (req, res) => {
    const { page = 1, pageSize = 10, memberId } = req.query;
    const skip = (page - 1) * pageSize;

    const filters = {};
    if (memberId) filters.memberId = memberId;

    const invoices = await SignedPDFLink.find(filters)
      .skip(skip)
      .limit(Number(pageSize))
      .sort({ createdAt: -1 });

    const total = await SignedPDFLink.countDocuments(filters);

    return res.json({
      success: true,
      data: invoices,
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  }),

  // Delete invoice link
  deleteInvoiceLink: asyncHandler(async (req, res) => {
    const link = await SignedPDFLink.findByIdAndDelete(req.params.id);

    if (!link) {
      throw new NotFoundError("Invoice link not found");
    }

    return res.json({
      success: true,
      message: "Invoice link deleted successfully",
    });
  }),
};

export default invoiceController;
