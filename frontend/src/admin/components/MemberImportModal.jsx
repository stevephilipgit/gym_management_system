// components/MemberImportModal.jsx — Super Admin bulk member import (CSV)
import { useState, useRef } from "react";
import apiClient from "../../utils/apiClient.js";
import { useToast } from "../../components/shared/ToastProvider";

const GENDERS = ["Male", "Female", "Transgender"];
const REQUIRED_HEADERS = ["gymId", "fullName", "fatherName", "gender", "dob", "phone", "aadhar", "bloodGroup", "address", "occupation", "gymPlan", "trainingType"];
// Alias map keys are normalized: lowercase, non-alphanumeric stripped.
// So "fatherName", "father_name", "Father's Name" all -> "fathername" -> fatherName.
const HEADER_ALIASES = {
  gymid: "gymId", gym: "gymId",
  name: "fullName", fullname: "fullName",
  father: "fatherName", fathername: "fatherName", fathersname: "fatherName",
  dob: "dob", dateofbirth: "dob",
  phone: "phone", mobile: "phone",
  aadhar: "aadhar", aadhaar: "aadhar", aadharnumber: "aadhar",
  bloodgroup: "bloodGroup", blood: "bloodGroup",
  address: "address",
  occupation: "occupation",
  plan: "gymPlan", gymplan: "gymPlan",
  trainingtype: "trainingType",
  gender: "gender",
};

// Simple CSV parser (handles basic quoted fields).
function parseCSV(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return rows;
  const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[HEADER_ALIASES[headers[j]] || headers[j]] = vals[j]?.trim() || "";
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export default function MemberImportModal({ isOpen, onClose }) {
  const [step, setStep] = useState("upload"); // upload | preview | result
  const [rows, setRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);
  const toast = useToast();

  if (!isOpen) return null;

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCSV(reader.result);
      if (parsed.length === 0) {
        toast.error("Could not parse CSV. Check the file format.");
        return;
      }
      // Check required headers
      const keys = Object.keys(parsed[0]);
      const missing = REQUIRED_HEADERS.filter((h) => !keys.includes(h));
      if (missing.length > 0) {
        toast.error(`Missing required columns: ${missing.join(", ")}`);
        return;
      }
      setRows(parsed);
      setStep("preview");
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await apiClient.post("/members/import", { members: rows });
      setResult(res.data);
      setStep("result");
    } catch (err) {
      toast.error(err.response?.data?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setRows([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const close = () => {
    reset();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4"
      onClick={() => !importing && close()}
      role="dialog"
      aria-modal="true"
      aria-label="Import Members"
    >
      <div
        className="w-full max-w-2xl rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-6 shadow-2xl border border-[var(--border-strong)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-xl font-semibold">Import Members</h3>
          <button type="button" onClick={close} disabled={importing} className="icon-close-btn" aria-label="Close modal">×</button>
        </div>

        {step === "upload" && (
          <div>
            <p className="mb-4 text-sm text-[var(--text-secondary)]">
              Upload a CSV file with historical member records. Required columns: <code className="text-[var(--text-primary)]">{REQUIRED_HEADERS.join(", ")}</code>.
            </p>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFile}
                className="saas-input"
                style={{ flex: 1 }}
              />
            </div>
            <div className="mt-6 flex justify-end gap-3 border-t border-[var(--border-color)] pt-5">
              <button type="button" onClick={close} className="btn-secondary min-h-0 px-4 py-2">Cancel</button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div>
            <p className="mb-3 text-sm text-[var(--text-secondary)]">
              {rows.length} record(s) parsed. Click <strong>Import Members</strong> to start the import.
            </p>
            <div className="max-h-64 overflow-auto rounded border border-[var(--border-color)] mb-4">
              <table className="saas-table" style={{ fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Gym ID</th>
                    <th>Name</th>
                    <th>Gender</th>
                    <th>Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((row, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{row.gymId}</td>
                      <td>{row.fullName}</td>
                      <td>{row.gender}</td>
                      <td>{row.phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 50 && (
              <p className="text-xs text-[var(--text-muted)] mb-3">Showing first 50 of {rows.length} rows.</p>
            )}
            <div className="flex justify-end gap-3 border-t border-[var(--border-color)] pt-5">
              <button type="button" onClick={reset} disabled={importing} className="btn-secondary min-h-0 px-4 py-2">Choose different file</button>
              <button type="button" onClick={handleImport} disabled={importing} className="btn-primary min-h-0 px-5 py-2">
                {importing ? "Importing…" : "Import Members"}
              </button>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div>
            <div className="mb-4 p-4 rounded border border-[var(--border-color)] bg-[var(--surface-muted)]">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Import Summary</p>
              <ul className="mt-2 text-sm space-y-1">
                <li className="text-[var(--success)]">Imported: {result.imported}</li>
                {result.skipped > 0 && <li className="text-[var(--warning)]">Skipped: {result.skipped}</li>}
                {result.failed > 0 && <li className="text-[var(--danger)]">Failed: {result.failed}</li>}
              </ul>
            </div>
            {result.errors?.length > 0 && (
              <div className="max-h-48 overflow-auto rounded border border-[var(--border-color)] mb-4">
                <table className="saas-table" style={{ fontSize: "12px" }}>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Field</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i}>
                        <td>{e.row}</td>
                        <td>{e.field}</td>
                        <td style={{ color: "var(--danger)" }}>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end gap-3 border-t border-[var(--border-color)] pt-5">
              <button type="button" onClick={close} className="btn-primary min-h-0 px-5 py-2">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}