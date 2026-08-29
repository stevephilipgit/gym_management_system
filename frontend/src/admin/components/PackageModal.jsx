// components/PackageModal.jsx — reusable Add/Edit package modal.
// mode = "create" | "edit". Used by the Packages page for both operations.
import { useState } from "react";

const EMPTY_FORM = {
  name: "",
  months: "",
  priceWeightLoss: "",
  priceWeightGain: "",
  priceTransformation: "",
  gender: "All",
};

const GENDER_OPTIONS = ["All", "Male", "Female", "Transgender"];
const PRICE_FIELDS = [
  { key: "priceWeightLoss", label: "Weight Loss (₹)" },
  { key: "priceWeightGain", label: "Weight Gain (₹)" },
  { key: "priceTransformation", label: "Transformation (₹)" },
];

function Field({ label, error, children, full }) {
  return (
    <div className="field-group" style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label className="field-label">{label}</label>
      {children}
      {error && <p className="pkg-field-error" role="alert">{error}</p>}
    </div>
  );
}

const initialFormFor = (mode, initialData) => {
  if (mode === "edit" && initialData) {
    return {
      name: initialData.name || "",
      months: initialData.months ?? "",
      priceWeightLoss: initialData.priceWeightLoss ?? "",
      priceWeightGain: initialData.priceWeightGain ?? "",
      priceTransformation: initialData.priceTransformation ?? "",
      gender: initialData.gender || "All",
    };
  }
  return { ...EMPTY_FORM };
};

export default function PackageModal({ isOpen, mode, initialData, saving, onSubmit, onClose }) {
  // The modal unmounts when closed (isOpen false), so state initializes fresh
  // on every open — no effect needed to reset it.
  const [form, setForm] = useState(() => initialFormFor(mode, initialData));
  const [errors, setErrors] = useState({});

  if (!isOpen) return null;

  const updateField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const handleNumber = (name, value) => {
    if (/^\d*$/.test(value)) updateField(name, value);
  };

  const validate = () => {
    const next = {};
    const name = form.name.trim();
    if (!name) next.name = "Package name is required.";
    else if (name.length > 100) next.name = "Package name must be 100 characters or fewer.";

    const months = Number(form.months);
    if (form.months === "" || !Number.isInteger(months) || months < 1 || months > 24) {
      next.months = "Duration must be a whole number between 1 and 24.";
    }

    PRICE_FIELDS.forEach(({ key }) => {
      const value = Number(form[key]);
      if (form[key] === "" || Number.isNaN(value) || value < 0) {
        next[key] = "Enter a valid non-negative amount.";
      }
    });

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (saving) return;
    if (!validate()) return;
    onSubmit({
      name: form.name.trim(),
      months: Number(form.months),
      priceWeightLoss: Number(form.priceWeightLoss),
      priceWeightGain: Number(form.priceWeightGain),
      priceTransformation: Number(form.priceTransformation),
      gender: form.gender,
    });
  };

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit Package" : "Add Package";
  const submitLabel = isEdit ? "Update Package" : "Add Package";
  const submittingLabel = isEdit ? "Updating..." : "Adding...";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4"
      onClick={() => !saving && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-6 shadow-2xl border border-[var(--border-strong)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-xl font-semibold">{title}</h3>
          <button type="button" onClick={onClose} disabled={saving} className="icon-close-btn" aria-label="Close modal">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <p className="pkg-modal-section">Package Details</p>
          <div className="pkg-modal-grid">
            <Field label="Package Name" error={errors.name} full>
              <input
                className="saas-input"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="e.g. Weight Loss 3 Month"
              />
            </Field>
            <Field label="Duration (Months)" error={errors.months}>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="saas-input"
                value={form.months}
                onChange={(e) => handleNumber("months", e.target.value)}
                placeholder="6"
              />
            </Field>
            <Field label="Gender" error={errors.gender}>
              <select
                className="saas-input"
                value={form.gender}
                onChange={(e) => updateField("gender", e.target.value)}
              >
                {GENDER_OPTIONS.map((g) => (
                  <option key={g} value={g}>{g === "All" ? "All Members" : g}</option>
                ))}
              </select>
            </Field>
          </div>

          <p className="pkg-modal-section">Pricing</p>
          <div className="pkg-modal-pricing">
            {PRICE_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label} error={errors[key]}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="saas-input"
                  value={form[key]}
                  onChange={(e) => handleNumber(key, e.target.value)}
                  placeholder="0"
                />
              </Field>
            ))}
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-[var(--border-color)] pt-5">
            <button type="button" onClick={onClose} disabled={saving} className="btn-secondary min-h-0 px-4 py-2">
              Cancel
            </button>
            <button type="submit" className="btn-primary min-h-0 px-5 py-2" disabled={saving}>
              {saving ? submittingLabel : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
