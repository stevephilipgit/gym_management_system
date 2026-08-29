// components/FieldModal.jsx — reusable Add/Edit dynamic form-field modal
// mode = "create" | "edit"
import { useState } from "react";

const FIELD_TYPES = ["text", "number", "date", "dropdown"];

const initialForm = (mode, initialData) => {
  if (mode === "edit" && initialData) {
    return {
      label: initialData.label || "",
      type: initialData.type || "text",
      required: initialData.required || false,
      options: initialData.type === "dropdown" ? [...(initialData.options || [])] : [],
    };
  }
  return { label: "", type: "text", required: false, options: [] };
};

function Field({ label, error, children, full }) {
  return (
    <div className="field-group" style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label className="field-label">{label}</label>
      {children}
      {error && <p className="pkg-field-error" role="alert">{error}</p>}
    </div>
  );
}

export default function FieldModal({ isOpen, mode, initialData, saving, onSubmit, onClose }) {
  const [form, setForm] = useState(() => initialForm(mode, initialData));
  const [errors, setErrors] = useState({});

  if (!isOpen) return null;

  const update = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const removeOption = (index) => {
    setForm((prev) => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== index),
    }));
  };

  const addOption = () => {
    setForm((prev) => ({ ...prev, options: [...prev.options, ""] }));
  };

  const setOption = (index, value) => {
    setForm((prev) => {
      const opts = [...prev.options];
      opts[index] = value;
      return { ...prev, options: opts };
    });
  };

  const validate = () => {
    const next = {};
    const label = form.label.trim();
    if (!label || label.length < 2) next.label = "Field label must be at least 2 characters.";
    if (!FIELD_TYPES.includes(form.type)) next.type = "Invalid field type.";
    if (form.type === "dropdown") {
      const valid = form.options.filter((o) => o.trim().length > 0);
      if (valid.length === 0) next.options = "Dropdown must have at least one option.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (saving) return;
    if (!validate()) return;
    onSubmit({
      label: form.label.trim(),
      type: form.type,
      required: form.required,
      options: form.type === "dropdown" ? form.options.filter((o) => o.trim().length > 0).map((o) => o.trim()) : [],
    });
  };

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit Form Field" : "Add Form Field";
  const submitLabel = isEdit ? "Update Field" : "Add Field";
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
          <button type="button" onClick={onClose} disabled={saving} className="icon-close-btn" aria-label="Close modal">×</button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <p className="pkg-modal-section">Field Details</p>
          <div className="pkg-modal-grid">
            <Field label="Field Label" error={errors.label} full>
              <input
                className="saas-input"
                value={form.label}
                onChange={(e) => update("label", e.target.value)}
                placeholder="e.g. Emergency Contact Name"
              />
            </Field>
            <Field label="Field Type" error={errors.type}>
              <select
                className="saas-input"
                value={form.type}
                onChange={(e) => {
                  const newType = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    type: newType,
                    options: newType === "dropdown" ? prev.options : [],
                  }));
                }}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </Field>
            <div className="field-group" style={{ gridColumn: "1 / -1" }}>
              <label className="checkbox-row" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={form.required}
                  onChange={(e) => update("required", e.target.checked)}
                  className="accent-check"
                />
                <span className="field-label" style={{ margin: 0 }}>Required field</span>
              </label>
            </div>
          </div>

          {form.type === "dropdown" && (
            <>
              <p className="pkg-modal-section">Options</p>
              <div className="field-options-list" style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                {form.options.map((opt, i) => (
                  <div key={i} className="field-option-row" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      className="saas-input"
                      value={opt}
                      onChange={(e) => setOption(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      className="btn-ghost min-h-0 px-2 py-1 text-xs"
                      disabled={form.options.length <= 1}
                      aria-label={`Remove option ${i + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addOption} className="btn-ghost min-h-0 px-3 py-1 text-xs" style={{ alignSelf: "flex-start" }}>
                  + Add Option
                </button>
              </div>
              {errors.options && (
                <p className="pkg-field-error" role="alert" style={{ marginBottom: "12px" }}>{errors.options}</p>
              )}
            </>
          )}

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