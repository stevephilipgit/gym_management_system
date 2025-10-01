import jsPDF from "jspdf";

const drawInvoiceHeader = (pdf, title, subtitle) => {
  pdf.setFillColor(15, 15, 15);
  pdf.rect(0, 0, 210, 28, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("GIRI GYM", 14, 14);
  pdf.setFontSize(8);
  pdf.setFont("helvetica", "normal");
  pdf.text("Chennai, Tamil Nadu, India", 14, 21);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(title, 196, 14, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(subtitle, 196, 21, { align: "right" });
  pdf.setTextColor(29, 29, 31);
};

const drawInvoiceTable = (pdf, rows, startY = 40) => {
  const left = 14;
  const labelWidth = 58;
  const valueWidth = 124;
  const rowHeight = 10;
  let y = startY;

  pdf.setDrawColor(38, 38, 38);
  pdf.setFontSize(9);

  rows.forEach(([label, value]) => {
    pdf.rect(left, y, labelWidth, rowHeight);
    pdf.rect(left + labelWidth, y, valueWidth, rowHeight);

    pdf.setFont("helvetica", "bold");
    pdf.text(String(label), left + 3, y + 6.5);
    pdf.setFont("helvetica", "normal");
    pdf.text(String(value ?? "-"), left + labelWidth + 3, y + 6.5);
    y += rowHeight;
  });

  return y;
};

const addDietAttachmentPage = (pdf, member, diet, invoiceContext, trainingType) => {
  pdf.addPage();
  drawInvoiceHeader(pdf, "DIET PLAN ATTACHMENT", "Attached to membership invoice");

  const infoRows = [
    ["Member", member.fullName || member.name || "-"],
    ["Gym ID", member.gymId || "-"],
    ["Training Type", trainingType || member.trainingType || "-"],
    ["Diet Plan", diet?.name || "Selected Diet"],
    ["Attached In", invoiceContext],
  ];

  let y = drawInvoiceTable(pdf, infoRows, 40) + 10;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("Diet Notes", 14, y);
  y += 8;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  const description =
    diet?.description?.trim() ||
    "Diet plan selected for this invoice. Follow the coach guidance provided by Giri Gym.";
  const wrapped = pdf.splitTextToSize(description, 176);
  pdf.rect(14, y - 4, 182, Math.max(26, wrapped.length * 6 + 8));
  pdf.text(wrapped, 18, y + 2);
};

export const downloadMembershipInvoice = ({
  member,
  mode = "bill",
  issuer = "Giri Gym Admin",
  planLabel,
  trainingType,
  price,
  validityLabel,
  paymentMode,
  diet = null,
  fileSuffix,
}) => {
  if (!member) return;

  const pdf = new jsPDF();
  const issuedAt = new Date();
  const invoiceTitle =
    mode === "renew"
      ? "MEMBERSHIP RENEWAL INVOICE"
      : mode === "registration"
        ? "MEMBERSHIP REGISTRATION INVOICE"
        : "CURRENT MEMBERSHIP INVOICE";
  const invoiceContext =
    mode === "renew"
      ? "Renewal Invoice"
      : mode === "registration"
        ? "Registration Invoice"
        : "Existing Membership Bill";
  const statusLabel =
    mode === "renew" ? "Renewed" : mode === "registration" ? "Registered" : "Active Membership";
  const resolvedPlan = planLabel || member.gymPlan || "-";
  const resolvedTraining = trainingType || member.trainingType || "-";
  const resolvedPrice = Number(price || 0);
  const resolvedValidity = validityLabel || "-";
  const resolvedPaymentMode = paymentMode || member.paymentMode || "-";
  const phone = member.phone || "-";
  const memberName = member.fullName || member.name || "-";

  drawInvoiceHeader(pdf, invoiceTitle, `${invoiceContext} | ${issuedAt.toLocaleDateString("en-GB")}`);

  const tableRows = [
    ["Invoice Type", invoiceContext],
    ["Issued On", issuedAt.toLocaleString("en-GB")],
    ["Issued By", issuer],
    ["Member Name", memberName],
    ["Gym ID", member.gymId || "-"],
    ["Phone", phone],
    ["Training Type", resolvedTraining],
    ["Plan", resolvedPlan],
    ["Valid Till", resolvedValidity],
    ["Payment Mode", resolvedPaymentMode],
    ["Amount", `Rs. ${resolvedPrice.toFixed(2)}`],
    ["Status", statusLabel],
  ];

  let y = drawInvoiceTable(pdf, tableRows, 40) + 12;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("Invoice Notes", 14, y);
  y += 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.5);
  const notes = pdf.splitTextToSize(
    mode === "renew"
      ? "This invoice confirms the renewed membership period recorded by Giri Gym. Keep this copy for your records."
      : mode === "registration"
        ? "This invoice confirms the member registration captured by Giri Gym. Keep this invoice for onboarding and billing records."
        : "This invoice represents the member's current active billing snapshot from Giri Gym records.",
    176
  );
  pdf.rect(14, y - 4, 182, Math.max(22, notes.length * 6 + 8));
  pdf.text(notes, 18, y + 1);

  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(8.5);
  pdf.text(`Authorized by ${issuer}`, 14, 284);
  pdf.text("Giri Gym | Member Billing Desk", 196, 284, { align: "right" });

  if (diet) {
    addDietAttachmentPage(pdf, member, diet, invoiceContext, resolvedTraining);
  }

  const suffix =
    fileSuffix ||
    (mode === "renew"
      ? "renewal_invoice"
      : mode === "registration"
        ? "registration_invoice"
        : "current_invoice");

  pdf.save(`${memberName.toLowerCase().replace(/\s+/g, "_")}_${member.gymId}_${suffix}.pdf`);
};
