import { useState } from "react";

export const InvoiceActions = ({ paymentLogId, memberPhone, memberName }) => {
  const [shareLink, setShareLink] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateShareLink = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${paymentLogId}/generate-share-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expirationHours: 24 }),
      });
      const data = await res.json();
      setShareLink(data);
    } catch (error) {
      alert("Failed to generate link");
    }
    setLoading(false);
  };

  const downloadPDF = async () => {
    try {
      const res = await fetch(`/api/invoices/${paymentLogId}/download`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `invoice_${paymentLogId}.pdf`;
      anchor.click();
    } catch (error) {
      alert("Failed to download");
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink.shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="panel mt-6">
      <div className="section-heading">
        <span className="eyebrow">Invoice Actions</span>
        <h4 className="panel-title">Share invoice</h4>
        <p className="panel-subtitle">
          {memberName ? `${memberName}` : "Member"} {memberPhone ? `- ${memberPhone}` : ""}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={downloadPDF} className="btn-secondary">
          Download Invoice
        </button>

        <button onClick={generateShareLink} disabled={loading || shareLink} className="btn-primary">
          {loading ? "Generating..." : "Generate WhatsApp Link"}
        </button>

        {shareLink && (
          <>
            <button onClick={() => window.open(shareLink.whatsappLink, "_blank")} className="btn-secondary">
              Send via WhatsApp
            </button>
            <button onClick={copyLink} className="btn-secondary">
              {copied ? "Copied" : "Copy Link"}
            </button>
          </>
        )}
      </div>

      {shareLink && <p className="muted-copy mt-4">Link expires: {new Date(shareLink.expiresAt).toLocaleString()}</p>}
    </div>
  );
};
