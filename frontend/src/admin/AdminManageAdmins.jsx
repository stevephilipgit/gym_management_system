import { useEffect, useState } from "react";
import { FiPlus } from "react-icons/fi";
import apiClient from "../utils/apiClient.js";
import IconButton from "./components/ui/IconButton";
import AdminAccountModal from "./components/AdminAccountModal";

const ROLE_LABELS = { superadmin: "Super Admin", trainer: "Trainer" };
const SCOPE_LABELS = {
  all: "All Members",
  male: "Male",
  female_plus_transgender: "Female + Transgender",
};
const STATUS_LABELS = { active: "Active", disabled: "Disabled" };

export default function AdminManageAdmins() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [tempPassword, setTempPassword] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create"); // "create" | "edit"
  const [editingAdmin, setEditingAdmin] = useState(null);
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

  const openCreate = () => {
    setModalMode("create");
    setEditingAdmin(null);
    setModalOpen(true);
  };

  const openEdit = (admin) => {
    setModalMode("edit");
    setEditingAdmin(admin);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingAdmin(null);
  };

  const handleSubmit = async (data) => {
    setSaving(true);
    try {
      if (modalMode === "edit") {
        await apiClient.put(`/admin/${editingAdmin._id}`, data);
        showNotice("Admin updated successfully.");
      } else {
        await apiClient.post("/admin/create", data);
        showNotice("Admin account created successfully. Share the credentials with the trainer.");
      }
      setModalOpen(false);
      setEditingAdmin(null);
      loadAdmins();
    } catch (err) {
      showNotice(err.response?.data?.message || "Failed to save admin.", "error");
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
    <div className="saas-container management-page">
      <div className="saas-page-header admins-page-header">
        <div>
          <h1>Admin Accounts</h1>
          <p>Create and manage Male Trainer / Female Trainer login credentials. Scope is locked at creation — trainers can only ever see their assigned gender's data.</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <FiPlus size={15} strokeWidth={2.5} aria-hidden="true" />
          Add Admin Account
        </button>
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

      <div className="management-table-scroll">
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
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{admin.email}</td>
                  <td>{ROLE_LABELS[admin.role] || admin.role}</td>
                  <td>{SCOPE_LABELS[admin.scope] || admin.scope}</td>
                  <td>
                    <span className={`saas-badge-pill ${admin.status === "active" ? "saas-badge-success" : "saas-badge-warning"}`}>
                      {STATUS_LABELS[admin.status] || admin.status}
                    </span>
                  </td>
                  <td className="pk-col-actions">
                    <IconButton type="edit" title="Edit admin account" aria-label={`Edit ${admin.username}`} onClick={() => openEdit(admin)} />
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
                    <IconButton type="delete" title="Delete account" aria-label={`Delete ${admin.username}`} onClick={() => confirmDelete(admin)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>

      <AdminAccountModal
        key={modalOpen ? `${modalMode}-${editingAdmin?._id || "new"}` : "closed"}
        isOpen={modalOpen}
        mode={modalMode}
        initialData={editingAdmin}
        saving={saving}
        onSubmit={handleSubmit}
        onClose={closeModal}
      />

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