// components/DietModal.jsx — reusable Add/Edit diet modal.
// mode = "create" | "edit". Used by the Diet Library page for both operations.
import { useState } from "react";

const EMPTY_FORM = { name: "", description: "", gender: "All" };
const GENDER_OPTIONS = ["All", "Male", "Female", "Transgender"];

function Field({ label, error, children, full }) {
  return (
    <div className="field-group" style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label className="field-label">{label}</label>
      {children}
      {error && <p className="pkg-field-error" role="alert">{error}</p>}
    </div>
  );
}

const initialForm = (mode, initialData) => {
  if (mode === "edit" && initialData) {
    return {
      name: initialData.name || "",
      description: initialData.description || "",
      gender: initialData.gender || "All",
    };
  }
  return { ...EMPTY_FORM };
};

export default function DietModal({ isOpen, mode, initialData, saving, showGenderSelect, onSubmit, onClose }) {
  // The modal unmounts when closed (isOpen false), so state initializes fresh
  // on every open — no effect needed to reset it.
  const [form, setForm] = useState(() => initialForm(mode, initialData));
  const [errors, setErrors] = useState({});

  if (!isOpen) return null;

  const updateField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const validate = () => {
    const next = {};
    const name = form.name.trim();
    if (!name) next.name = "Diet name is required.";
    else if (name.length < 3 || name.length > 100) next.name = "Diet name must be 3–100 characters.";
    if (!["All", "Male", "Female", "Transgender"].includes(form.gender)) {
      next.gender = "Select a valid gender scope.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (saving) return;
    if (!validate()) return;
    onSubmit({
      name: form.name.trim(),
      description: form.description,
      gender: form.gender,
    });
  };

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit Diet" : "Create Diet";
  const submitLabel = isEdit ? "Update Diet" : "Create Diet";
  const submittingLabel = isEdit ? "Updating..." : "Creating...";

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
          <p className="pkg-modal-section">Diet Details</p>
          <div className="pkg-modal-grid">
            <Field label="Diet Name" error={errors.name} full>
              <input
                className="saas-input"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="e.g. Weight Loss Plan"
              />
            </Field>
            <Field label="Description" error={errors.description} full>
              <textarea
                className="saas-input"
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                rows={4}
                placeholder="Describe the diet plan..."
                style={{ height: "auto", padding: "10px 12px", resize: "vertical" }}
              />
            </Field>
            <Field label="Gender Scope" error={errors.gender}>
              {showGenderSelect ? (
                <select
                  className="saas-input"
                  value={form.gender}
                  onChange={(e) => updateField("gender", e.target.value)}
                >
                  {GENDER_OPTIONS.map((g) => (
                    <option key={g} value={g}>{g === "All" ? "All Members" : g}</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-[var(--text-secondary)]" style={{ padding: "8px 0" }}>
                  Gender is locked to <strong>{form.gender || "your scope"}</strong> (your trainer scope).
                </p>
              )}
            </Field>
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