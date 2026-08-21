import { useEffect, useState } from "react";
import apiClient from "../utils/apiClient.js";
import IconButton from "./components/ui/IconButton";

/**
 * AdminManageAdmins — superadmin-only module to create and manage admin
 * accounts (male trainers / female trainers). Gender scope is mandatory at
 * creation; trainers can never be created with "all" scope (backend enforces
 * this too — the UI just guides).
 */
const SCOPE_OPTIONS = {
  superadmin: [
    { value: "all", label: "All Members (Superadmin)" },
  ],
  trainer: [
    { value: "male", label: "Male Trainer (Male members only)" },
    { value: "female_plus_transgender", label: "Female Trainer (Female + Transgender members)" },
  ],
};

// Explicit account types — the superadmin picks what kind of account they are
// creating. This removes the scope-default trap (a "female trainer" can never
// accidentally be created with male scope).
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
const STATUS_LABELS = { active: "Active", disabled: "Disabled" };

const EMPTY_FORM = {
  fullName: "",
  username: "",
  email: "",
  accountType: "male",
  password: "",
};

export default function AdminManageAdmins() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [tempPassword, setTempPassword] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadAdmins = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("/admin/list");
      setAdmins(res.data?.data || res.data || []);
    } catch (err) {
      console.log("LOAD ADMINS ERROR:", err);
      showNotice("Failed to load admin accounts.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdmins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showNotice = (msg, type = "success") => {
    setNotice({ msg, type });
    window.clearTimeout(showNotice._timer);
    showNotice._timer = window.setTimeout(() => setNotice(null), 3500);
  };

  const updateField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const saveAdmin = async (e) => {
    e.preventDefault();
    if (!form.fullName.trim()) return showNotice("Full name is required.", "error");
    if (!form.username.trim() || form.username.trim().length < 3) return showNotice("Username must be at least 3 characters.", "error");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return showNotice("Enter a valid email address.", "error");
    if (form.password.length < 8) return showNotice("Password must be at least 8 characters.", "error");
    if (!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/.test(form.password)) return showNotice("Password must include uppercase, lowercase and a digit.", "error");

    // Derive role + scope from the explicit account type — no ambiguity.
    const accountType = ACCOUNT_TYPES.find((t) => t.value === form.accountType) || ACCOUNT_TYPES[0];
    const payload = {
      fullName: form.fullName.trim(),
      username: form.username.trim(),
      email: form.email.trim().toLowerCase(),
      role: accountType.role,
      scope: accountType.scope,
      password: form.password,
    };

    setSaving(true);
    try {
      await apiClient.post("/admin/create", payload);
      showNotice("Admin account created successfully. Share the credentials with the trainer.");
      setForm({ ...EMPTY_FORM });
      loadAdmins();
    } catch (err) {
      showNotice(err.response?.data?.message || "Failed to create admin.", "error");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (admin) => {
    setEditTarget(admin);
    setEditForm({
      fullName: admin.fullName || "",
      email: admin.email || "",
      role: admin.role || "trainer",
      scope: admin.scope || "male",
      status: admin.status || "active",
    });
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      await apiClient.put(`/admin/${editTarget._id}`, editForm);
      showNotice("Admin updated successfully.");
      setEditTarget(null);
      loadAdmins();
    } catch (err) {
      showNotice(err.response?.data?.message || "Failed to update admin.", "error");
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (admin) => {
    if (!window.confirm(`Reset password for "${admin.username}"? This logs them out everywhere and shows a temporary password.`)) return;
    setSaving(true);
    try {
      const res = await apiClient.post(`/admin/reset-password/${admin._id}`);
      setTempPassword(res.data?.tempPassword || null);
      showNotice("Password reset. Share the temporary password with the trainer.");
      loadAdmins();
    } catch (err) {
      showNotice(err.response?.data?.message || "Failed to reset password.", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (admin) => {
    const nextStatus = admin.status === "active" ? "disabled" : "active";
    setSaving(true);
    try {
      await apiClient.put(`/admin/${admin._id}`, { status: nextStatus });
      showNotice(nextStatus === "active" ? "Admin re-enabled." : "Admin disabled — all sessions revoked.");
      loadAdmins();
    } catch (err) {
      showNotice(err.response?.data?.message || "Failed to update status.", "error");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (admin) => setDeleteTarget(admin);

  const deleteAdmin = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await apiClient.delete(`/admin/${deleteTarget._id}`);
      showNotice("Admin account deleted.");
      setDeleteTarget(null);
      loadAdmins();
    } catch (err) {
      showNotice(err.response?.data?.message || "Failed to delete admin.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="saas-container">
      <div className="saas-page-header">
        <h1>Admin Accounts</h1>
        <p>Create and manage Male Trainer / Female Trainer login credentials. Scope is locked at creation — trainers can only ever see their assigned gender's data.</p>
      </div>

      {notice && (
        <div className={`pkg-notice pkg-notice-${notice.type}`} role="status">
          {notice.msg}
        </div>
      )}

      {tempPassword && (
        <div className="pkg-notice pkg-notice-success" role="status">
          <strong>Temporary password for the trainer: {tempPassword}</strong> — share it securely and ask them to change it on first login.
        </div>
      )}

      {/* Create form */}
      <form onSubmit={saveAdmin} className="pkg-form" aria-label="Create admin account">
        <div className="pkg-form-grid">
          <Field label="Full Name">
            <input className="saas-input" value={form.fullName} onChange={(e) => updateField("fullName", e.target.value)} placeholder="e.g. Ravi Trainer" />
          </Field>

          <Field label="Username">
            <input className="saas-input" value={form.username} onChange={(e) => updateField("username", e.target.value)} placeholder="e.g. ravi_trainer" autoComplete="off" />
          </Field>

          <Field label="Email">
            <input type="email" className="saas-input" value={form.email} onChange={(e) => updateField("email", e.target.value)} placeholder="trainer@gym.com" autoComplete="off" />
          </Field>

          <Field label="Password (min 8, upper+lower+digit)">
            <input type="text" className="saas-input" value={form.password} onChange={(e) => updateField("password", e.target.value)} placeholder="Temporary password" autoComplete="off" />
          </Field>

          <Field label="Account Type">
            <select className="saas-input" value={form.accountType} onChange={(e) => updateField("accountType", e.target.value)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label} — {t.note}</option>
              ))}
            </select>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {ACCOUNT_TYPES.find((t) => t.value === form.accountType)?.note || ""}
            </p>
          </Field>
        </div>

        <div className="pkg-form-actions">
          <button type="submit" className="btn-primary min-h-0 px-5 py-2" disabled={saving}>
            {saving ? "Creating..." : "Create Admin Account"}
          </button>
        </div>
      </form>

      {/* Admin list */}
      <div className="saas-table-container pk-table">
        <table className="saas-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Username</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Scope</th>
              <th scope="col">Status</th>
              <th className="pk-col-actions" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" className="pk-empty">Loading admin accounts…</td></tr>
            ) : admins.length === 0 ? (
              <tr><td colSpan="7" className="pk-empty">No admin accounts yet.</td></tr>
            ) : (
              admins.map((admin) => (
                <tr key={admin._id || admin.id}>
                  <td className="pk-name">{admin.fullName}</td>
                  <td>{admin.username}</td>
                  <td>{admin.email}</td>
                  <td>{ROLE_LABELS[admin.role] || admin.role}</td>
                  <td>{SCOPE_LABELS[admin.scope] || admin.scope}</td>
                  <td>
                    <span className={`px-3 py-1 rounded-full text-white text-xs font-semibold ${admin.status === "active" ? "bg-green-600" : "bg-gray-500"}`}>
                      {STATUS_LABELS[admin.status] || admin.status}
                    </span>
                  </td>
                  <td className="pk-col-actions">
                    <IconButton type="edit" title="Edit role/scope/status" onClick={() => openEdit(admin)} />
                    <button
                      className="text-xs underline text-[var(--text-secondary)] hover:text-[var(--text-primary)] mr-2"
                      onClick={() => toggleStatus(admin)}
                      title={admin.status === "active" ? "Disable (revokes all sessions)" : "Re-enable"}
                    >
                      {admin.status === "active" ? "Disable" : "Enable"}
                    </button>
                    <button className="text-xs underline text-[var(--text-secondary)] hover:text-[var(--text-primary)] mr-2" onClick={() => resetPassword(admin)}>
                      Reset Password
                    </button>
                    <IconButton type="delete" title="Delete account" onClick={() => confirmDelete(admin)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4">
          <div className="w-full max-w-md rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-6 shadow-2xl border border-[var(--border-strong)]">
            <h3 className="mb-4 text-xl font-semibold">Edit admin — {editTarget.username}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <Field label="Full Name">
                <input className="saas-input" value={editForm.fullName || ""} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} />
              </Field>
              <Field label="Email">
                <input className="saas-input" value={editForm.email || ""} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </Field>
              <Field label="Role">
                <select className="saas-input" value={editForm.role} onChange={(e) => {
                  const role = e.target.value;
                  const opts = SCOPE_OPTIONS[role] || [];
                  setEditForm((prev) => ({
                    ...prev,
                    role,
                    scope: opts.length > 0 && !opts.some((o) => o.value === prev.scope) ? opts[0].value : prev.scope,
                  }));
                }}>
                  <option value="trainer">Trainer</option>
                  <option value="superadmin">Super Admin</option>
                </select>
              </Field>
              <Field label="Gender Scope">
                <select className="saas-input" value={editForm.scope} onChange={(e) => setEditForm({ ...editForm, scope: e.target.value })}>
                  {(SCOPE_OPTIONS[editForm.role] || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select className="saas-input" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </Field>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setEditTarget(null)} className="btn-secondary min-h-0 px-4 py-2">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="btn-primary min-h-0 px-4 py-2">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4">
          <div className="w-full max-w-sm rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-6 shadow-2xl border border-[var(--border-strong)]">
            <h3 className="mb-2 text-xl font-semibold">Delete admin account?</h3>
            <p className="mb-6 text-[var(--text-secondary)]">
              "{deleteTarget.username}" will be removed and all their sessions revoked. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="btn-secondary min-h-0 px-4 py-2">Cancel</button>
              <button onClick={deleteAdmin} className="btn-danger min-h-0 px-4 py-2">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
