import { useEffect, useState } from "react";
import apiClient from "../utils/apiClient.js";

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

  const deletePackage = async (id) => {
    if (!window.confirm("Delete this package?")) return;
    try {
      await apiClient.delete(`/packages/${id}`);
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
    <div className="section-stack">
      <form onSubmit={savePackage} className="panel">
        <div className="section-heading">
          <span className="eyebrow">Packages</span>
          <h2 className="text-3xl">{editingId ? "Edit package" : "Add package"}</h2>
          <p className="panel-subtitle">Maintain plan duration and training-specific pricing from one screen.</p>
        </div>

        <div className="form-grid-2 mt-6">
          <Field label="Package Name">
            <input className="field-control" value={form.name} onChange={(e) => updateField("name", e.target.value)} />
          </Field>

          <Field label="Duration (Months)">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="field-control"
              value={form.months}
              onChange={(e) => handleNumberInput("months", e.target.value)}
            />
          </Field>

          <Field label="Weight Loss Price">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="field-control"
              value={form.priceWeightLoss}
              onChange={(e) => handleNumberInput("priceWeightLoss", e.target.value)}
            />
          </Field>

          <Field label="Weight Gain Price">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="field-control"
              value={form.priceWeightGain}
              onChange={(e) => handleNumberInput("priceWeightGain", e.target.value)}
            />
          </Field>

          <Field label="Transformation Price">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="field-control"
              value={form.priceTransformation}
              onChange={(e) => handleNumberInput("priceTransformation", e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button className="btn-primary">{editingId ? "Update Package" : "Add Package"}</button>
          {editingId && (
            <button type="button" onClick={resetForm} className="btn-secondary">
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <section className="table-shell">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Months</th>
                <th>Weight Loss</th>
                <th>Weight Gain</th>
                <th>Transformation</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg) => (
                <tr key={pkg._id}>
                  <td>{pkg.name}</td>
                  <td>{pkg.months}</td>
                  <td>{pkg.priceWeightLoss}</td>
                  <td>{pkg.priceWeightGain}</td>
                  <td>{pkg.priceTransformation}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => editPackage(pkg)} className="btn-primary min-h-0 px-4 py-2">
                        Edit
                      </button>
                      <button onClick={() => deletePackage(pkg._id)} className="btn-danger min-h-0 px-4 py-2">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {packages.length === 0 && (
                <tr>
                  <td colSpan="6">
                    <div className="empty-state">No packages created yet.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
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
