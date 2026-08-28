import { useEffect, useState } from "react";
import apiClient from "../utils/apiClient.js";
import IconButton from "./components/ui/IconButton";

const EMPTY_FORM = {
  name: "",
  months: "",
  priceWeightLoss: "",
  priceWeightGain: "",
  priceTransformation: "",
  gender: "All",
};

const formatPrice = (value) => {
  const num = Number(value);
  if (value === "" || value === null || value === undefined || Number.isNaN(num)) return "—";
  return `₹${num.toLocaleString("en-IN")}`;
};

export default function AdminManagePackages() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [packageToDelete, setPackageToDelete] = useState(null);
  const [genderFilter, setGenderFilter] = useState("All");

  useEffect(() => {
    loadPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genderFilter]);

  const showNotice = (msg, type = "success") => {
    setNotice({ msg, type });
    window.clearTimeout(showNotice._timer);
    showNotice._timer = window.setTimeout(() => setNotice(null), 3500);
  };

  const loadPackages = async () => {
    setLoading(true);
    try {
      const params = genderFilter && genderFilter !== "All" ? { gender: genderFilter } : {};
      const res = await apiClient.get("/packages", { params });
      setPackages(res.data?.data || res.data || []);
    } catch (err) {
      console.log("LOAD PACKAGE ERROR:", err);
      showNotice("Failed to load packages.", "error");
    } finally {
      setLoading(false);
    }
  };

  const updateField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
  };

  const savePackage = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return showNotice("Package name is required.", "error");
    if (!form.months || Number(form.months) <= 0) return showNotice("Duration (months) is required and must be greater than 0.", "error");

    const payload = {
      name: form.name.trim(),
      months: Number(form.months),
      priceWeightLoss: Number(form.priceWeightLoss),
      priceWeightGain: Number(form.priceWeightGain),
      priceTransformation: Number(form.priceTransformation),
      gender: form.gender,
    };

    setSaving(true);
    try {
      if (editingId) {
        await apiClient.put(`/packages/${editingId}`, payload);
        showNotice("Package updated successfully.");
      } else {
        await apiClient.post("/packages", payload);
        showNotice("Package created successfully.");
      }
      resetForm();
      loadPackages();
    } catch (err) {
      console.log("SAVE PACKAGE ERROR:", err);
      showNotice(err.response?.data?.message || "Failed to save package.", "error");
    } finally {
      setSaving(false);
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
      gender: pkg.gender || "All",
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
      showNotice("Package deleted.");
      loadPackages();
    } catch (err) {
      console.log("DELETE PACKAGE ERROR:", err);
      showNotice("Failed to delete package.", "error");
    }
  };

  const handleNumberInput = (name, value) => {
    if (/^\d*$/.test(value)) {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  return (
    <div className="saas-container">
      <div className="saas-page-header">
        <h3>Maintain plan duration and training-specific pricing from one screen.</h3>
      </div>

      {notice && (
        <div className={`pkg-notice pkg-notice-${notice.type}`} role="status">
          {notice.msg}
        </div>
      )}

      <form onSubmit={savePackage} className="pkg-form" aria-label="Add or edit package">
        <div className="pkg-form-grid">
          <div className="field-group pk-name-field">
            <label className="field-label" htmlFor="pkg-name">Package Name</label>
            <input id="pkg-name" className="saas-input" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="e.g. Weight Loss 3 Month" />
          </div>

          <Field label="Duration (Months)">
            <input type="text" inputMode="numeric" pattern="[0-9]*" className="saas-input" value={form.months} onChange={(e) => handleNumberInput("months", e.target.value)} placeholder="6" />
          </Field>

          <Field label="Weight Loss (₹)">
            <input type="text" inputMode="numeric" pattern="[0-9]*" className="saas-input" value={form.priceWeightLoss} onChange={(e) => handleNumberInput("priceWeightLoss", e.target.value)} placeholder="0" />
          </Field>

          <Field label="Weight Gain (₹)">
            <input type="text" inputMode="numeric" pattern="[0-9]*" className="saas-input" value={form.priceWeightGain} onChange={(e) => handleNumberInput("priceWeightGain", e.target.value)} placeholder="0" />
          </Field>

          <Field label="Transformation (₹)">
            <input type="text" inputMode="numeric" pattern="[0-9]*" className="saas-input" value={form.priceTransformation} onChange={(e) => handleNumberInput("priceTransformation", e.target.value)} placeholder="0" />
          </Field>

          <Field label="Gender">
            <select className="saas-input" value={form.gender} onChange={(e) => updateField("gender", e.target.value)}>
              <option value="All">All Members</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Transgender">Transgender</option>
            </select>
          </Field>
        </div>

        <div className="pkg-form-actions">
          {editingId && (
            <button type="button" onClick={resetForm} className="btn-ghost min-h-0 px-4 py-2">Cancel</button>
          )}
          <button type="submit" className="btn-primary min-h-0 px-5 py-2" disabled={saving}>
            {editingId ? "Update Package" : "Add Package"}
          </button>
        </div>
      </form>

      <div className="saas-filter-bar" style={{ marginBottom: '16px' }}>
        <label className="field-label" style={{ margin: 0 }}>Filter by Gender</label>
        <select
          className="saas-input"
          style={{ width: '220px' }}
          value={genderFilter}
          onChange={(e) => setGenderFilter(e.target.value)}
        >
          <option value="All">All Members</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="Transgender">Transgender</option>
        </select>
      </div>

      <div className="saas-table-container pk-table">
        <table className="saas-table">
          <thead>
            <tr>
              <th className="pk-col-idx" scope="col">#</th>
              <th scope="col">Package Name</th>
              <th className="pk-col-num" scope="col">Months</th>
              <th className="pk-col-num" scope="col">Weight Loss</th>
              <th className="pk-col-num" scope="col">Weight Gain</th>
              <th className="pk-col-num" scope="col">Transformation</th>
              <th scope="col">Gender</th>
              <th className="pk-col-actions" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" className="pk-empty">Loading packages…</td>
              </tr>
            ) : packages.length === 0 ? (
              <tr>
                <td colSpan="8" className="pk-empty">No packages created yet. Add your first package above.</td>
              </tr>
            ) : (
              packages.map((pkg, index) => (
                <tr key={pkg._id}>
                  <td className="pk-col-idx">{index + 1}</td>
                  <td className="pk-name">{pkg.name}</td>
                  <td className="pk-col-num">{pkg.months}</td>
                  <td className="pk-col-num">{formatPrice(pkg.priceWeightLoss)}</td>
                  <td className="pk-col-num">{formatPrice(pkg.priceWeightGain)}</td>
                  <td className="pk-col-num">{formatPrice(pkg.priceTransformation)}</td>
                  <td>{pkg.gender || "All"}</td>
                  <td className="pk-col-actions">
                    <IconButton type="edit" title="Edit package" aria-label={`Edit ${pkg.name}`} onClick={() => editPackage(pkg)} />
                    <IconButton type="delete" title="Delete package" aria-label={`Delete ${pkg.name}`} onClick={() => confirmDelete(pkg._id)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && packages.length > 0 && (
        <div className="pk-table-footer">
          <span>Showing {packages.length} package{packages.length === 1 ? "" : "s"}</span>
        </div>
      )}

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
