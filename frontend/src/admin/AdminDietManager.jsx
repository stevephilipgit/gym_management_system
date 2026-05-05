import { useEffect, useState } from "react";
import apiClient from "../utils/apiClient.js";
import IconButton from "./components/IconButton";

export const AdminDietManager = () => {
  const [diets, setDiets] = useState([]);
  const [formData, setFormData] = useState({ name: "", description: "" });
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [dietToDelete, setDietToDelete] = useState(null);

  useEffect(() => {
    fetchDiets();
  }, []);

  const fetchDiets = async () => {
    try {
      const res = await apiClient.get("/diets");
      const dietList = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
      setDiets(dietList);
      setError("");
    } catch (fetchError) {
      setError("Failed to fetch diets");
      setDiets([]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (editingId) {
        await apiClient.put(`/diets/${editingId}`, formData);
      } else {
        await apiClient.post("/diets", formData);
      }

      setFormData({ name: "", description: "" });
      setEditingId(null);
      await fetchDiets();
    } catch (submitError) {
      setError(submitError?.response?.data?.message || "Operation failed");
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = (id) => {
    setDietToDelete(id);
    setDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!dietToDelete) return;

    try {
      await apiClient.delete(`/diets/${dietToDelete}`);
      setDeleteModalOpen(false);
      setDietToDelete(null);
      await fetchDiets();
    } catch (deleteError) {
      setError(deleteError?.response?.data?.message || "Delete failed");
      setDeleteModalOpen(false);
    }
  };

  const handleEdit = (diet) => {
    setFormData({ name: diet.name, description: diet.description });
    setEditingId(diet._id);
  };

  return (
    <div className="saas-container">
      <div className="saas-header">
        <h1>Diet Library</h1>
        <p>Manage reusable diet plans and descriptions used during member workflows.</p>
      </div>

      {error && <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 mb-6">{error}</div>}

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <form onSubmit={handleSubmit} style={{ flex: '1 1 300px', background: 'var(--surface-muted)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: 'var(--text-primary)' }}>{editingId ? "Edit diet" : "Create diet"}</h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Field label="Diet Name">
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="saas-input"
                style={{ width: '100%' }}
              />
            </Field>

            <Field label="Description">
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows="4"
                className="saas-input"
                style={{ width: '100%', height: 'auto', padding: '12px', resize: 'vertical' }}
              />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
            <button type="submit" disabled={loading} className="btn-primary" style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 600, cursor: 'pointer' }}>
              {editingId ? "Update Diet" : "Create Diet"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setFormData({ name: "", description: "" });
                  setEditingId(null);
                }}
                className="btn-secondary"
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="saas-table-container" style={{ flex: '2 1 500px' }}>
          <table className="saas-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th style={{ width: '80px', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {diets.map((diet) => (
                <tr key={diet._id}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{diet.name}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>{diet.description?.substring(0, 80) || "-"}</td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '4px' }}>
                      <IconButton type="edit" onClick={() => handleEdit(diet)} />
                      <IconButton type="delete" onClick={() => confirmDelete(diet._id)} />
                    </div>
                  </td>
                </tr>
              ))}

              {diets.length === 0 && (
                <tr>
                  <td colSpan="3" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                    No diets created yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4">
          <div className="w-full max-w-sm rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-6 shadow-2xl border border-[var(--border-strong)]">
            <h3 className="mb-2 text-xl font-semibold">Delete Diet?</h3>
            <p className="mb-6 text-[var(--text-secondary)]">This action cannot be undone. Are you sure you want to delete this diet plan?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteModalOpen(false)} className="btn-secondary min-h-0 px-4 py-2">Cancel</button>
              <button onClick={handleDelete} className="btn-danger min-h-0 px-4 py-2">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function Field({ label, children }) {
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
