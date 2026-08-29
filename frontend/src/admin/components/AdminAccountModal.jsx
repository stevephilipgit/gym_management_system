// components/AdminAccountModal.jsx — reusable Add/Edit admin account modal.
// mode = "create" | "edit"
import { useState } from "react";

const ACCOUNT_TYPES = [
  {
    value: "male",
    label: "Male Trainer",
    role: "trainer",
    scope: "male",
    note: "Sees male members only",
  },
  {
    value: "female",
    label: "Female Trainer",
    role: "trainer",
    scope: "female_plus_transgender",
    note: "Sees female + transgender members only",
  },
  {
    value: "superadmin",
    label: "Super Admin",
    role: "superadmin",
    scope: "all",
    note: "Full access to every module",
  },
];

const ROLE_LABELS = { superadmin: "Super Admin", trainer: "Trainer" };
const SCOPE_LABELS = {
  all: "All Members",
  male: "Male",
  female_plus_transgender: "Female + Transgender",
};

const initialForm = (mode, initialData) => {
  if (mode === "edit" && initialData) {
    return {
      fullName: initialData.fullName || "",
      email: initialData.email || "",
      role: initialData.role || "trainer",
      scope: initialData.scope || "male",
      status: initialData.status || "active",
      // create-only fields
      username: "",
      accountType: "male",
      password: "",
    };
  }
  return {
    fullName: "",
    username: "",
    email: "",
    accountType: "male",
    password: "",
    role: "trainer",
    scope: "male",
    status: "active",
  };
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

export default function AdminAccountModal({ isOpen, mode, initialData, saving, onSubmit, onClose }) {
  const [form, setForm] = useState(() => initialForm(mode, initialData));
  const [errors, setErrors] = useState({});

  if (!isOpen) return null;

  const update = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const isEdit = mode === "edit";
  const selectedType = ACCOUNT_TYPES.find((t) => t.value === form.accountType);
  const title = isEdit ? "Edit Admin Account" : "Add Admin Account";
  const submitLabel = isEdit ? "Save Changes" : "Create Admin Account";
  const submittingLabel = isEdit ? "Saving..." : "Creating...";

  const validate = () => {
    const next = {};
    if (!form.fullName.trim()) next.fullName = "Full name is required.";
    if (!isEdit) {
      if (!form.username.trim() || form.username.trim().length < 3) next.username = "Username must be at least 3 characters.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = "Enter a valid email address.";
      const pw = form.password;
      if (pw.length < 8) next.password = "Password must be at least 8 characters.";
      else if (!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/.test(pw)) next.password = "Password must include uppercase, lowercase and a digit.";
      if (!ACCOUNT_TYPES.some((t) => t.value === form.accountType)) next.accountType = "Select a valid account type.";
    } else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = "Enter a valid email address.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (saving) return;
    if (!validate()) return;

    if (isEdit) {
      onSubmit({
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        status: form.status,
      });
    } else {
      const accountType = ACCOUNT_TYPES.find((t) => t.value === form.accountType) || ACCOUNT_TYPES[0];
      onSubmit({
        fullName: form.fullName.trim(),
        username: form.username.trim(),
        email: form.email.trim().toLowerCase(),
        role: accountType.role,
        scope: accountType.scope,
        password: form.password,
      });
    }
  };

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
          {!isEdit ? (
            <>
              <p className="pkg-modal-section">Account Details</p>
              <div className="pkg-modal-grid">
                <Field label="Full Name" error={errors.fullName} full>
                  <input className="saas-input" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} placeholder="e.g. Ravi Trainer" />
                </Field>
                <Field label="Username" error={errors.username}>
                  <input className="saas-input" value={form.username} onChange={(e) => update("username", e.target.value)} placeholder="e.g. ravi_trainer" autoComplete="off" />
                </Field>
                <Field label="Email" error={errors.email}>
                  <input type="email" className="saas-input" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="trainer@gym.com" autoComplete="off" />
                </Field>
                <Field label="Temporary Password" error={errors.password} full>
                  <input type="text" className="saas-input" value={form.password} onChange={(e) => update("password", e.target.value)} placeholder="Min 8 chars, upper+lower+digit" autoComplete="off" />
                </Field>
                <Field label="Account Type" error={errors.accountType} full>
                  <select className="saas-input" value={form.accountType} onChange={(e) => update("accountType", e.target.value)}>
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  {selectedType && (
                    <p className="text-xs text-[var(--text-secondary)] mt-1">
                      {selectedType.note}
                    </p>
                  )}
                </Field>
              </div>
            </>
          ) : (
            <>
              <p className="pkg-modal-section">Account Details</p>
              <div className="pkg-modal-grid">
                <Field label="Full Name" error={errors.fullName} full>
                  <input className="saas-input" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} />
                </Field>
                <Field label="Email" error={errors.email} full>
                  <input type="email" className="saas-input" value={form.email} onChange={(e) => update("email", e.target.value)} />
                </Field>
                <div className="field-group">
                  <label className="field-label">Role</label>
                  <p className="text-sm text-[var(--text-primary)]" style={{ padding: "8px 0" }}>{ROLE_LABELS[form.role] || form.role}</p>
                </div>
                <div className="field-group">
                  <label className="field-label">Scope</label>
                  <p className="text-sm text-[var(--text-primary)]" style={{ padding: "8px 0" }}>{SCOPE_LABELS[form.scope] || form.scope}</p>
                </div>
                <div className="field-group">
                  <label className="field-label">Status</label>
                  <select className="saas-input" value={form.status} onChange={(e) => update("status", e.target.value)}>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)]">Role and scope are locked at creation.</p>
            </>
          )}

          <div className="mt-6 flex justify-end gap-3 border-t border-[var(--border-color)] pt-5">
            <button type="button" onClick={onClose} disabled={saving} className="btn-secondary min-h-0 px-4 py-2">Cancel</button>
            <button type="submit" className="btn-primary min-h-0 px-5 py-2" disabled={saving}>
              {saving ? submittingLabel : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}