import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the Unicode-capable NotoSans font (supports ₹ U+20B9)
const NOTO_SANS_FONT = path.join(__dirname, "fonts", "NotoSans-Regular.ttf");

class PDFGenerator {
  /**
   * Generate Analytics PDF
   */
  static generateAnalyticsPDF(metrics, dateRange) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];

        doc.on("data", (data) => buffers.push(data));
        doc.on("end", () => resolve(Buffer.concat(buffers)));

        // Register Unicode font
        doc.registerFont("NotoSans", NOTO_SANS_FONT);

        // Header
        doc.font("NotoSans").fontSize(20).text("Analytics Report", { align: "center" });
        doc.font("NotoSans").fontSize(10).text(
          `Period: ${dateRange.startDate} to ${dateRange.endDate}`,
          { align: "center" }
        );
        doc.font("NotoSans").text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
        doc.moveDown();

        // Summary Section
        doc.font("NotoSans").fontSize(14).text("Summary Metrics");
        doc.font("NotoSans").fontSize(10);
        this.addMetricRow(doc, "Total Revenue", `\u20B9${(metrics.totalRevenue || 0).toLocaleString()}`);
        this.addMetricRow(
          doc,
          "New Joining Revenue",
          `\u20B9${(metrics.newJoiningRevenue || 0).toLocaleString()}`
        );
        this.addMetricRow(doc, "Renewal Revenue", `\u20B9${(metrics.renewalRevenue || 0).toLocaleString()}`);
        this.addMetricRow(doc, "Total Transactions", metrics.totalTransactions || 0);

        doc.moveDown();

        // Income by Plan Table
        doc.font("NotoSans").fontSize(12).text("Income by Plan");
        if (metrics.incomeByPlan && metrics.incomeByPlan.length > 0) {
          this.addTable(
            doc,
            ["Plan Name", "Count", "Amount"],
            metrics.incomeByPlan.map((p) => [
              p.planName || "-",
              (p.count || 0).toString(),
              `\u20B9${(p.amount || 0).toLocaleString()}`,
            ])
          );
        } else {
          doc.font("NotoSans").fontSize(10).text("No data available", 50);
          doc.moveDown();
        }

        doc.moveDown();

        // Income by Training Type Table
        doc.font("NotoSans").fontSize(12).text("Income by Training Type");
        if (metrics.incomeByTrainingType && metrics.incomeByTrainingType.length > 0) {
          this.addTable(
            doc,
            ["Training Type", "Count", "Amount"],
            metrics.incomeByTrainingType.map((t) => [
              t.trainingType || "-",
              (t.count || 0).toString(),
              `\u20B9${(t.amount || 0).toLocaleString()}`,
            ])
          );
        } else {
          doc.font("NotoSans").fontSize(10).text("No data available", 50);
          doc.moveDown();
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate Analytics PDF from Finance Data (Dashboard Format)
   *
   * Converts dashboard data format to PDF
   * Input format from /api/finance/income:
   * {
   *   totalAmount: number,
   *   newVsRenew: { new: number, renewal: number },
   *   plans: { planName: amount, ... },
   *   trainingTypes: { trainingType: amount, ... },
   *   logs: [ { paidAt, amount }, ... ]
   * }
   */
  static generateAnalyticsPDFFromFinanceData(financeData, dateRange) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40 });
        const buffers = [];

        doc.on("data", (data) => buffers.push(data));
        doc.on("end", () => resolve(Buffer.concat(buffers)));

        // Register Unicode font
        doc.registerFont("NotoSans", NOTO_SANS_FONT);

        // Header
        doc.font("NotoSans").fontSize(20).text("Analytics Report", { align: "center" });
        doc.font("NotoSans").fontSize(9).text(
          `Period: ${dateRange.startDate} to ${dateRange.endDate}`,
          { align: "center" }
        );
        doc.font("NotoSans").text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
        doc.moveDown(1.5);

        // Summary Metrics Table
        doc.font("NotoSans").fontSize(13).text("Summary Metrics");
        doc.moveDown(0.5);
        this.addBorderedTable(
          doc,
          ["Metric", "Value"],
          [
            ["Total Revenue", `\u20B9${(financeData.totalAmount || 0).toLocaleString()}`],
            ["New Joining Revenue", `\u20B9${(financeData.newVsRenew?.new || 0).toLocaleString()}`],
            ["Renewal Revenue", `\u20B9${(financeData.newVsRenew?.renewal || 0).toLocaleString()}`],
            ["Total Transactions", (financeData.logs?.length || 0).toString()],
          ]
        );
        doc.moveDown(1.5);

        // Income by Plan Table
        const plansData = financeData.plans || {};
        doc.font("NotoSans").fontSize(13).text("Income by Plan");
        doc.moveDown(0.5);
        if (Object.keys(plansData).length > 0) {
          this.addBorderedTable(
            doc,
            ["Plan Name", "Amount"],
            Object.entries(plansData).map(([planName, amount]) => [
              planName || "-",
              `\u20B9${(amount || 0).toLocaleString()}`,
            ])
          );
        } else {
          doc.font("NotoSans").fontSize(10).text("No data available", 50);
        }
        doc.moveDown(1.5);

        // Income by Training Type Table
        const trainingData = financeData.trainingTypes || {};
        doc.font("NotoSans").fontSize(13).text("Income by Training Type");
        doc.moveDown(0.5);
        if (Object.keys(trainingData).length > 0) {
          this.addBorderedTable(
            doc,
            ["Training Type", "Amount"],
            Object.entries(trainingData).map(([trainingType, amount]) => [
              trainingType || "-",
              `\u20B9${(amount || 0).toLocaleString()}`,
            ])
          );
        } else {
          doc.font("NotoSans").fontSize(10).text("No data available", 50);
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Add two-column metric row
   */
  static addMetricRow(doc, label, value) {
    const y = doc.y;
    doc.font("NotoSans").fontSize(10);
    doc.text(`${label}:`, 50, y, { width: 200 });
    doc.text(value, 300, y, { width: 200 });
    doc.moveDown(0.5);
  }

  /**
   * Add simple table
   */
  static addTable(doc, headers, rows) {
    const colWidth = 130;
    const rowHeight = 20;
    const startX = 50;
    let y = doc.y;

    // Headers
    doc.font("NotoSans").fontSize(10);
    headers.forEach((header, i) => {
      doc.text(header, startX + i * colWidth, y, { width: colWidth });
    });
    y += rowHeight;

    // Rows
    doc.font("NotoSans").fontSize(9);
    rows.forEach((row) => {
      row.forEach((cell, i) => {
        doc.text(cell.toString(), startX + i * colWidth, y, { width: colWidth });
      });
      y += rowHeight;
    });

    doc.moveTo(startX, y).lineTo(startX + headers.length * colWidth, y).stroke();
  }

  /**
   * Add table with proper borders and spacing
   */
  static addBorderedTable(doc, headers, rows) {
    const pageWidth = doc.page.width;
    const marginLeft = 40;
    const marginRight = 40;
    const availableWidth = pageWidth - marginLeft - marginRight;

    // Calculate column widths (50% each for 2 columns)
    const colWidths = headers.map(() => availableWidth / headers.length);
    const rowHeight = 25;
    const cellPadding = 8;

    let startY = doc.y;
    let y = startY;

    // Draw header background and borders
    doc.fillColor("#e0e0e0").rect(marginLeft, y, availableWidth, rowHeight).fill();

    // Draw header text
    doc.fillColor("#000000").font("NotoSans").fontSize(10);
    headers.forEach((header, i) => {
      const x = marginLeft + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
      doc.text(header, x + cellPadding, y + cellPadding, {
        width: colWidths[i] - cellPadding * 2,
        align: "left",
      });
    });
    y += rowHeight;

    // Draw data rows
    doc.font("NotoSans").fontSize(9);
    rows.forEach((row, rowIndex) => {
      // Alternate row colors
      if (rowIndex % 2 === 0) {
        doc.fillColor("#f9f9f9").rect(marginLeft, y, availableWidth, rowHeight).fill();
      }

      // Draw row borders
      doc.strokeColor("#cccccc").lineWidth(0.5);
      doc.rect(marginLeft, y, availableWidth, rowHeight).stroke();

      // Draw cell content
      doc.fillColor("#000000");
      row.forEach((cell, i) => {
        const x = marginLeft + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(cell.toString(), x + cellPadding, y + cellPadding, {
          width: colWidths[i] - cellPadding * 2,
          align: i === 0 ? "left" : "right", // Right align amounts
        });
      });
      y += rowHeight;
    });

    // Draw outer border
    doc.strokeColor("#000000").lineWidth(1);
    doc.rect(marginLeft, startY, availableWidth, y - startY).stroke();

    doc.y = y;
  }

  /**
   * Generate Invoice PDF (with optional Diet Plan page)
   */
  static generateInvoicePDF(paymentData, memberData, dietData = null) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument();
        const buffers = [];

        doc.on("data", (data) => buffers.push(data));
        doc.on("end", () => resolve(Buffer.concat(buffers)));

        // Register Unicode font
        doc.registerFont("NotoSans", NOTO_SANS_FONT);

        // Page 1: Invoice
        this.addInvoicePage(doc, paymentData, memberData);

        // Page 2: Diet Plan (if selected)
        if (dietData) {
          doc.addPage();
          this.addDietPage(doc, dietData);
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  static addInvoicePage(doc, paymentData, memberData) {
    doc.font("NotoSans").fontSize(16).text("GYM INVOICE", { align: "center" });
    doc.font("NotoSans").fontSize(10);
    doc.text(`Invoice #: ${paymentData.invoiceId}`);
    doc.text(`Date: ${new Date(paymentData.date).toLocaleDateString()}`);
    doc.moveDown();

    doc.font("NotoSans").fontSize(11).text("Member Details");
    doc.font("NotoSans").fontSize(10);
    doc.text(`Name: ${memberData.name}`);
    doc.text(`Gym ID: ${memberData.gymId}`);
    doc.text(`Phone: ${memberData.phone}`);
    doc.moveDown();

    doc.font("NotoSans").fontSize(11).text("Billing Details");
    doc.font("NotoSans").fontSize(10);
    doc.text(`Plan: ${paymentData.planName}`);
    doc.text(`Amount: \u20B9${paymentData.amount}`);
    doc.text(`Valid Till: ${new Date(paymentData.validityEnd).toLocaleDateString()}`);
    doc.moveDown();

    if (paymentData.dietIncluded) {
      doc.text(`\u2713 Diet Plan Included`);
    }
  }

  static addDietPage(doc, dietData) {
    const pageWidth = doc.page.width;
    const marginLeft = 40;
    const marginRight = 40;
    const availableWidth = pageWidth - marginLeft - marginRight;

    // ── Section heading ──────────────────────────────────────────────────────
    doc
      .font("NotoSans")
      .fontSize(16)
      .fillColor("#000000")
      .text("Diet Plan Details", { align: "center" });
    doc.moveDown(1.5);

    // ── Column layout ─────────────────────────────────────────────────────────
    // Column 1 (Diet Name): 35%   Column 2 (Description): 65%
    const col1Width = Math.floor(availableWidth * 0.35);
    const col2Width = availableWidth - col1Width;
    const headerHeight = 28;
    const cellPaddingX = 10;
    const cellPaddingY = 8;

    let y = doc.y;

    // ── Header row ────────────────────────────────────────────────────────────
    doc.fillColor("#2c3e50").rect(marginLeft, y, availableWidth, headerHeight).fill();
    doc.fillColor("#ffffff").font("NotoSans").fontSize(11);

    // Header col 1
    doc.text("Diet Name", marginLeft + cellPaddingX, y + cellPaddingY, {
      width: col1Width - cellPaddingX * 2,
      align: "left",
    });
    // Header col 2
    doc.text("Description / Instructions", marginLeft + col1Width + cellPaddingX, y + cellPaddingY, {
      width: col2Width - cellPaddingX * 2,
      align: "left",
    });

    y += headerHeight;

    // ── Draw vertical divider in header ───────────────────────────────────────
    doc
      .strokeColor("#ffffff")
      .lineWidth(0.5)
      .moveTo(marginLeft + col1Width, y - headerHeight)
      .lineTo(marginLeft + col1Width, y)
      .stroke();

    // ── Data row ─────────────────────────────────────────────────────────────
    const dietName = (dietData.name || "").toString();
    const dietDescription = (dietData.description || "").toString().trim();

    // Pre-calculate text heights so the row can accommodate the taller cell
    doc.font("NotoSans").fontSize(10);
    const nameHeight = doc.heightOfString(dietName, {
      width: col1Width - cellPaddingX * 2,
    });
    const descHeight = doc.heightOfString(dietDescription || "—", {
      width: col2Width - cellPaddingX * 2,
    });
    const rowHeight = Math.max(nameHeight, descHeight) + cellPaddingY * 2;

    // Row background (light alternating)
    doc.fillColor("#f4f6f8").rect(marginLeft, y, availableWidth, rowHeight).fill();

    // Row border
    doc.strokeColor("#cccccc").lineWidth(0.5).rect(marginLeft, y, availableWidth, rowHeight).stroke();

    // Vertical column divider
    doc
      .strokeColor("#cccccc")
      .lineWidth(0.5)
      .moveTo(marginLeft + col1Width, y)
      .lineTo(marginLeft + col1Width, y + rowHeight)
      .stroke();

    // Cell text – Diet Name
    doc.fillColor("#000000").font("NotoSans").fontSize(10);
    doc.text(dietName, marginLeft + cellPaddingX, y + cellPaddingY, {
      width: col1Width - cellPaddingX * 2,
      align: "left",
    });

    // Cell text – Description
    doc.text(dietDescription || "\u2014", marginLeft + col1Width + cellPaddingX, y + cellPaddingY, {
      width: col2Width - cellPaddingX * 2,
      align: "left",
    });

    y += rowHeight;

    // ── Outer border around entire table ─────────────────────────────────────
    doc
      .strokeColor("#2c3e50")
      .lineWidth(1)
      .rect(marginLeft, doc.y - rowHeight - headerHeight, availableWidth, headerHeight + rowHeight)
      .stroke();

    doc.y = y + 10;
  }
}

export default PDFGenerator;
