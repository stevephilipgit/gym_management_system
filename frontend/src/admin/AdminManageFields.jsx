import { useEffect, useState } from "react";
import apiClient from "../utils/apiClient.js";
import ToggleSwitch from "./components/ui/ToggleSwitch";
import IconButton from "./components/ui/IconButton";

export default function AdminManageFields() {
  const [fields, setFields] = useState([]);
  const [form, setForm] = useState({
    label: "",
    type: "text",
    required: false,
    options: "",
  });
  const [loading, setLoading] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState(null);

  useEffect(() => {
    loadFields();
  }, []);

  const loadFields = async () => {
    try {
      const res = await apiClient.get("/fields/member");
      setFields(res.data?.data || res.data || []);
    } catch (err) {
      console.error("Error loading fields:", err);
      alert("Failed to load fields");
    }
  };

  const createField = async (e) => {
    e.preventDefault();

    if (!form.label.trim()) return alert("Label is required");
    if (form.type === "dropdown" && (!form.options || form.options.length === 0)) {
      return alert("Dropdown must have at least one option");
    }

    try {
      await apiClient.post(
        "/fields/member",
        {
          ...form,
          options: form.type === "dropdown" ? form.options.split(",").map((option) => option.trim()) : [],
        }
      );

      setForm({ label: "", type: "text", required: false, options: "" });
      loadFields();
    } catch (err) {
      alert(err.response?.data?.message || "Failed");
    }
  };

  const toggleField = async (id) => {
    try {
      setLoading(true);
      await apiClient.patch(`/fields/member/${id}/toggle`, {});
      await loadFields();
    } catch (err) {
      console.error("Toggle error:", err.response?.data);
      alert(`Error: ${err.response?.data?.message || "Failed to toggle field"}`);
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = (id) => {
    setFieldToDelete(id);
    setDeleteModalOpen(true);
  };

  const deleteField = async () => {
    if (!fieldToDelete) return;
    try {
      await apiClient.delete(`/fields/member/${fieldToDelete}`);
      setDeleteModalOpen(false);
      setFieldToDelete(null);
      loadFields();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to delete field");
    }
  };

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="section-heading">
          <span className="eyebrow">Dynamic Schema</span>
          <h2 className="text-3xl">Manage form fields</h2>
          <p className="panel-subtitle">Add custom fields and control whether they are required or enabled.</p>
        </div>

        <form onSubmit={createField} className="form-grid-2 mt-6">
          <Field label="Field Label">
            <input
              placeholder="Emergency Contact"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="field-control"
            />
          </Field>

          <Field label="Field Type">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="field-control">
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="dropdown">Dropdown</option>
            </select>
          </Field>

          {form.type === "dropdown" && (
            <Field label="Dropdown Options">
              <input
                placeholder="Option 1, Option 2"
                value={form.options}
                onChange={(e) => setForm({ ...form, options: e.target.value })}
                className="field-control"
              />
            </Field>
          )}

          <div className="checkbox-row mt-8">
            <input
              type="checkbox"
              checked={form.required}
              onChange={(e) => setForm({ ...form, required: e.target.checked })}
              className="accent-check"
            />
            <span>Required field</span>
          </div>

          <div className="md:col-span-2">
            <button className="btn-primary">Add Field</button>
          </div>
        </form>
      </section>

      <section className="table-shell">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Type</th>
                <th>Required</th>
                <th>Options</th>
                <th>Status</th>
                <th style={{ width: '80px', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {fields.map((field) => (
                <tr key={field._id}>
                  <td>{field.label}</td>
                  <td>{field.type}</td>
                  <td>{field.required ? "Yes" : "No"}</td>
                  <td>{field.type === "dropdown" ? field.options.join(", ") : "-"}</td>
                  <td>
                    <ToggleSwitch 
                      active={field.isEnabled} 
                      onClick={() => toggleField(field._id)} 
                      disabled={loading} 
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="flex justify-center gap-2">
                      <IconButton 
                        type="delete" 
                        onClick={() => confirmDelete(field._id)} 
                        disabled={loading} 
                      />
                    </div>
                  </td>
                </tr>
              ))}

              {fields.length === 0 && (
                <tr>
                  <td colSpan="6">
                    <div className="empty-state">No custom fields added yet.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4">
          <div className="w-full max-w-sm rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-6 shadow-2xl border border-[var(--border-strong)]">
            <h3 className="mb-2 text-xl font-semibold">Delete Field?</h3>
            <p className="mb-6 text-[var(--text-secondary)]">This action cannot be undone. Are you sure you want to permanently delete this field?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteModalOpen(false)} className="btn-secondary min-h-0 px-4 py-2">Cancel</button>
              <button onClick={deleteField} className="btn-danger min-h-0 px-4 py-2">Delete</button>
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
