import { useEffect, useState } from "react";
import { FiPlus } from "react-icons/fi";
import apiClient from "../utils/apiClient.js";
import IconButton from "./components/ui/IconButton";
import DietModal from "./components/DietModal";
import { canAccess, useAdmin } from "./authContext.js";
import { useToast } from "../components/shared/ToastProvider";

export const AdminDietManager = () => {
  const [diets, setDiets] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [genderFilter, setGenderFilter] = useState("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create"); // "create" | "edit"
  const [editingDiet, setEditingDiet] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [dietToDelete, setDietToDelete] = useState(null);
  const admin = useAdmin();
  const toast = useToast();
  const isSuperadmin = canAccess(admin?.role, ["superadmin"]);

  useEffect(() => {
    fetchDiets();
  }, []);

  const fetchDiets = async () => {
    setFetching(true);
    setFetchError("");
    try {
      const res = await apiClient.get("/diets");
      const dietList = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
      setDiets(dietList);
    } catch (fetchError) {
      console.log("FETCH DIETS ERROR:", fetchError);
      setFetchError("Failed to fetch diets");
      setDiets([]);
    } finally {
      setFetching(false);
    }
  };

  const openCreate = () => {
    setModalMode("create");
    setEditingDiet(null);
    setModalOpen(true);
  };

  const openEdit = (diet) => {
    setModalMode("edit");
    setEditingDiet(diet);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingDiet(null);
  };

  const handleSubmit = async (data) => {
    setSaving(true);
    try {
      // Trainers: gender is locked to their scope — never send it.
      const payload = isSuperadmin ? data : { name: data.name, description: data.description };
      if (modalMode === "edit") {
        await apiClient.put(`/diets/${editingDiet._id}`, payload);
        toast.success("Diet updated successfully.");
      } else {
        await apiClient.post("/diets", payload);
        toast.success("Diet created successfully.");
      }
      setModalOpen(false);
      setEditingDiet(null);
      fetchDiets();
    } catch (submitError) {
      console.log("SAVE DIET ERROR:", submitError);
      toast.error(submitError?.response?.data?.message || "Operation failed");
    } finally {
      setSaving(false);
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
      toast.success("Diet deleted.");
      fetchDiets();
    } catch (deleteError) {
      console.log("DELETE DIET ERROR:", deleteError);
      toast.error(deleteError?.response?.data?.message || "Delete failed");
    }
  };

  // Local gender filter on the already-loaded diet list. "All" diets are
  // applicable to every gender, matching the backend scope semantics
  // (allowedDietGenders returns ["All", ...scope genders]).
  const filteredDiets =
    genderFilter === "All"
      ? diets
      : diets.filter((d) => d.gender === "All" || d.gender === genderFilter);

  return (
    <div className="saas-container management-page">
      <div className="saas-page-header diet-page-header">
        <div>
          <h1>Diet Library</h1>
          <p>Manage reusable diet plans and descriptions used during member workflows.</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <FiPlus size={15} strokeWidth={2.5} aria-hidden="true" />
          Create Diet
        </button>
      </div>

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

      <div className="management-table-scroll">
      <div className="saas-table-container diet-table">
        <table className="saas-table">
          <thead>
            <tr>
              <th className="pk-col-idx" scope="col">#</th>
              <th scope="col">Name</th>
              <th scope="col">Description</th>
              <th scope="col">Gender</th>
              <th className="pk-col-actions" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {fetching ? (
              <tr>
                <td colSpan="5" className="pk-empty">Loading diets…</td>
              </tr>
            ) : fetchError ? (
              <tr>
                <td colSpan="5" className="pk-empty">
                  Unable to load diets.{' '}
                  <button onClick={fetchDiets} className="btn-secondary min-h-0 px-3 py-1 text-xs">Retry</button>
                </td>
              </tr>
            ) : filteredDiets.length === 0 ? (
              <tr>
                <td colSpan="5" className="pk-empty">
                  {diets.length === 0 ? "No diets created yet." : "No diets match the selected gender."}
                </td>
              </tr>
            ) : (
              filteredDiets.map((diet, index) => (
                <tr key={diet._id}>
                  <td className="pk-col-idx">{index + 1}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{diet.name}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
                    {diet.description?.substring(0, 80) || "-"}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {diet.gender === "All" ? "All Members" : diet.gender}
                  </td>
                  <td className="pk-col-actions">
                    <IconButton type="edit" title="Edit diet" aria-label={`Edit ${diet.name}`} onClick={() => openEdit(diet)} />
                    {isSuperadmin && <IconButton type="delete" title="Delete diet" aria-label={`Delete ${diet.name}`} onClick={() => confirmDelete(diet._id)} />}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>

      {!fetching && !fetchError && filteredDiets.length > 0 && (
        <div className="pk-table-footer">
          <span>Showing {filteredDiets.length} diet{filteredDiets.length === 1 ? "" : "s"}</span>
        </div>
      )}

      <DietModal
        key={modalOpen ? `${modalMode}-${editingDiet?._id || "new"}` : "closed"}
        isOpen={modalOpen}
        mode={modalMode}
        initialData={editingDiet}
        saving={saving}
        showGenderSelect={isSuperadmin}
        onSubmit={handleSubmit}
        onClose={closeModal}
      />

      {deleteModalOpen && (
        <div className="modal-shell" onClick={() => setDeleteModalOpen(false)}>
          <div className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-diet-title" onClick={(e) => e.stopPropagation()}>
            <div className="confirmation-dialog-header">
              <h3 id="delete-diet-title" className="confirmation-dialog-title">Delete Diet?</h3>
              <button type="button" className="icon-close-btn confirmation-dialog-close" onClick={() => setDeleteModalOpen(false)} aria-label="Close delete diet dialog" title="Close">×</button>
            </div>
            <p className="confirmation-dialog-body">This action cannot be undone. Are you sure you want to delete this diet plan?</p>
            <div className="confirmation-dialog-actions">
              <button onClick={() => setDeleteModalOpen(false)} className="btn-secondary min-h-0 px-4 py-2">Cancel</button>
              <button onClick={handleDelete} className="btn-danger min-h-0 px-4 py-2">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}