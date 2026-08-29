import { useEffect, useState } from "react";
import { FiPlus } from "react-icons/fi";
import apiClient from "../utils/apiClient.js";
import IconButton from "./components/ui/IconButton";
import PackageModal from "./components/PackageModal";

const formatPrice = (value) => {
  const num = Number(value);
  if (value === "" || value === null || value === undefined || Number.isNaN(num)) return "—";
  return `₹${num.toLocaleString("en-IN")}`;
};

export default function AdminManagePackages() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState(null);
  const [genderFilter, setGenderFilter] = useState("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create"); // "create" | "edit"
  const [editingPackage, setEditingPackage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [packageToDelete, setPackageToDelete] = useState(null);

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
    setLoadError(false);
    try {
      const params = genderFilter && genderFilter !== "All" ? { gender: genderFilter } : {};
      const res = await apiClient.get("/packages", { params });
      setPackages(res.data?.data || res.data || []);
    } catch (err) {
      console.log("LOAD PACKAGE ERROR:", err);
      setLoadError(true);
      setPackages([]);
      showNotice("Failed to load packages.", "error");
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setModalMode("create");
    setEditingPackage(null);
    setModalOpen(true);
  };

  const openEdit = (pkg) => {
    setModalMode("edit");
    setEditingPackage(pkg);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingPackage(null);
  };

  const handleSubmit = async (data) => {
    setSaving(true);
    try {
      if (modalMode === "edit") {
        await apiClient.put(`/packages/${editingPackage._id}`, data);
        showNotice("Package updated successfully.");
      } else {
        await apiClient.post("/packages", data);
        showNotice("Package created successfully.");
      }
      setModalOpen(false);
      setEditingPackage(null);
      loadPackages();
    } catch (err) {
      console.log("SAVE PACKAGE ERROR:", err);
      showNotice(err.response?.data?.message || "Failed to save package.", "error");
    } finally {
      setSaving(false);
    }
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

  return (
    <div className="saas-container">
      <div className="saas-page-header pkg-page-header">
        <div>
          <h1>Packages</h1>
          <p>Maintain plan duration and training-specific pricing from one screen.</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <FiPlus size={15} strokeWidth={2.5} aria-hidden="true" />
          Add Package
        </button>
      </div>

      {notice && (
        <div className={`pkg-notice pkg-notice-${notice.type}`} role="status">
          {notice.msg}
        </div>
      )}

      <div className="saas-filter-bar" style={{ marginBottom: '16px' }}>
        <label className="field-label" style={{ margin: 0 }}>Filter Packages by Gender</label>
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
            ) : loadError ? (
              <tr>
                <td colSpan="8" className="pk-empty">
                  Unable to load packages.{' '}
                  <button onClick={loadPackages} className="btn-secondary min-h-0 px-3 py-1 text-xs">Retry</button>
                </td>
              </tr>
            ) : packages.length === 0 ? (
              <tr>
                <td colSpan="8" className="pk-empty">No packages found.</td>
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
                    <IconButton type="edit" title="Edit package" aria-label={`Edit ${pkg.name}`} onClick={() => openEdit(pkg)} />
                    <IconButton type="delete" title="Delete package" aria-label={`Delete ${pkg.name}`} onClick={() => confirmDelete(pkg._id)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && !loadError && packages.length > 0 && (
        <div className="pk-table-footer">
          <span>Showing {packages.length} package{packages.length === 1 ? "" : "s"}</span>
        </div>
      )}

      <PackageModal
        key={modalOpen ? `${modalMode}-${editingPackage?._id || "new"}` : "closed"}
        isOpen={modalOpen}
        mode={modalMode}
        initialData={editingPackage}
        saving={saving}
        onSubmit={handleSubmit}
        onClose={closeModal}
      />

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
