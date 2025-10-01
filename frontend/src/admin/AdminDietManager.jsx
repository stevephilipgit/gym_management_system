import { useEffect, useState } from "react";
import apiClient from "../utils/apiClient.js";

export const AdminDietManager = () => {
  const [diets, setDiets] = useState([]);
  const [formData, setFormData] = useState({ name: "", description: "" });
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this diet?")) return;

    try {
      await apiClient.delete(`/diets/${id}`);
      await fetchDiets();
    } catch (deleteError) {
      setError(deleteError?.response?.data?.message || "Delete failed");
    }
  };

  const handleEdit = (diet) => {
    setFormData({ name: diet.name, description: diet.description });
    setEditingId(diet._id);
  };

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="section-heading">
          <span className="eyebrow">Diet Library</span>
          <h2 className="text-3xl">{editingId ? "Edit diet" : "Create diet"}</h2>
          <p className="panel-subtitle">Manage reusable diet plans and descriptions used during member workflows.</p>
        </div>

        {error && <div className="status-pill status-pill-danger mt-6">{error}</div>}

        <form onSubmit={handleSubmit} className="section-stack mt-6">
          <div className="form-grid-2">
            <Field label="Diet Name">
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="field-control"
              />
            </Field>

            <Field label="Description">
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows="4"
                className="field-control"
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={loading} className="btn-primary">
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
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="table-shell">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {diets.map((diet) => (
                <tr key={diet._id}>
                  <td>{diet.name}</td>
                  <td>{diet.description?.substring(0, 80) || "-"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => handleEdit(diet)} className="btn-primary min-h-0 px-4 py-2">
                        Edit
                      </button>
                      <button onClick={() => handleDelete(diet._id)} className="btn-danger min-h-0 px-4 py-2">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {diets.length === 0 && (
                <tr>
                  <td colSpan="3">
                    <div className="empty-state">No diets created yet.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
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
