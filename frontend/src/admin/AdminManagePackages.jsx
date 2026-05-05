import { useEffect, useState } from "react";
import apiClient from "../utils/apiClient.js";
import IconButton from "./components/IconButton";

export default function AdminManagePackages() {
  const [packages, setPackages] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: "",
    months: "",
    priceWeightLoss: "",
    priceWeightGain: "",
    priceTransformation: "",
  });
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [packageToDelete, setPackageToDelete] = useState(null);

  useEffect(() => {
    loadPackages();
  }, []);

  const loadPackages = async () => {
    try {
      const res = await apiClient.get("/packages");
      setPackages(res.data?.data || res.data || []);
    } catch (err) {
      console.log("LOAD PACKAGE ERROR:", err);
    }
  };

  const updateField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const resetForm = () => {
    setForm({
      name: "",
      months: "",
      priceWeightLoss: "",
      priceWeightGain: "",
      priceTransformation: "",
    });
    setEditingId(null);
  };

  const savePackage = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return alert("Package name required");
    if (!form.months) return alert("Duration (months) required");

    const payload = {
      name: form.name.trim(),
      months: Number(form.months),
      priceWeightLoss: Number(form.priceWeightLoss),
      priceWeightGain: Number(form.priceWeightGain),
      priceTransformation: Number(form.priceTransformation),
    };

    try {
      if (editingId) {
        await apiClient.put(`/packages/${editingId}`, payload);
        alert("Package updated");
      } else {
        await apiClient.post("/packages", payload);
        alert("Package created");
      }

      resetForm();
      loadPackages();
    } catch (err) {
      console.log("SAVE PACKAGE ERROR:", err);
      alert(err.response?.data?.message || "Failed");
    }
  };

  const editPackage = (pkg) => {
    setEditingId(pkg._id);
    setForm({
      name: pkg.name,
      months: pkg.months,
      priceWeightLoss: pkg.priceWeightLoss,
      priceWeightGain: pkg.priceWeightGain,
      priceTransformation: pkg.priceTransformation,
    });
  };

  const confirmDelete = (id) => {
    setPackageToDelete(id);
    setDeleteModalOpen(true);
  };

  const deletePackage = async () => {
    if (!packageToDelete) return;
    try {
      await apiClient.delete(`/packages/${packageToDelete}`);
      setDeleteModalOpen(false);
      setPackageToDelete(null);
      loadPackages();
    } catch (err) {
      alert("Failed to delete package");
    }
  };

  const handleNumberInput = (name, value) => {
    if (/^\d*$/.test(value)) {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  return (
    <div className="saas-container">
      <div className="saas-header">
        <h1>Packages</h1>
        <p>Maintain plan duration and training-specific pricing from one screen.</p>
      </div>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <form onSubmit={savePackage} style={{ flex: '1 1 300px', background: 'var(--surface-muted)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: 'var(--text-primary)' }}>{editingId ? "Edit package" : "Add package"}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Field label="Package Name">
              <input className="saas-input" value={form.name} onChange={(e) => updateField("name", e.target.value)} style={{ width: '100%' }} />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Field label="Duration (Months)">
                <input type="text" inputMode="numeric" pattern="[0-9]*" className="saas-input" value={form.months} onChange={(e) => handleNumberInput("months", e.target.value)} style={{ width: '100%' }} />
              </Field>
              <Field label="Weight Loss">
                <input type="text" inputMode="numeric" pattern="[0-9]*" className="saas-input" value={form.priceWeightLoss} onChange={(e) => handleNumberInput("priceWeightLoss", e.target.value)} style={{ width: '100%' }} />
              </Field>
              <Field label="Weight Gain">
                <input type="text" inputMode="numeric" pattern="[0-9]*" className="saas-input" value={form.priceWeightGain} onChange={(e) => handleNumberInput("priceWeightGain", e.target.value)} style={{ width: '100%' }} />
              </Field>
              <Field label="Transformation">
                <input type="text" inputMode="numeric" pattern="[0-9]*" className="saas-input" value={form.priceTransformation} onChange={(e) => handleNumberInput("priceTransformation", e.target.value)} style={{ width: '100%' }} />
              </Field>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button className="btn-primary" style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 600, cursor: 'pointer' }}>{editingId ? "Update" : "Add"}</button>
              {editingId && (
                <button type="button" onClick={resetForm} className="btn-secondary" style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              )}
            </div>
          </div>
        </form>

        <div className="saas-table-container" style={{ flex: '2 1 500px' }}>
          <table className="saas-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Months</th>
                <th>Weight Loss</th>
                <th>Weight Gain</th>
                <th>Transformation</th>
                <th style={{ width: '80px', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg) => (
                <tr key={pkg._id}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{pkg.name}</td>
                  <td>{pkg.months}</td>
                  <td>{pkg.priceWeightLoss}</td>
                  <td>{pkg.priceWeightGain}</td>
                  <td>{pkg.priceTransformation}</td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '4px' }}>
                      <IconButton type="edit" onClick={() => editPackage(pkg)} />
                      <IconButton type="delete" onClick={() => confirmDelete(pkg._id)} />
                    </div>
                  </td>
                </tr>
              ))}

              {packages.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                    No packages created yet.
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
            <h3 className="mb-2 text-xl font-semibold">Delete Package?</h3>
            <p className="mb-6 text-[var(--text-secondary)]">This action cannot be undone. Are you sure you want to delete this package?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteModalOpen(false)} className="btn-secondary min-h-0 px-4 py-2">Cancel</button>
              <button onClick={deletePackage} className="btn-danger min-h-0 px-4 py-2">Delete</button>
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
