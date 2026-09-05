import { useEffect, useState } from "react";
import { FiPlus } from "react-icons/fi";
import apiClient from "../utils/apiClient.js";
import ToggleSwitch from "./components/ui/ToggleSwitch";
import IconButton from "./components/ui/IconButton";
import FieldModal from "./components/FieldModal";
import { useToast } from "../components/shared/ToastProvider";

const formatOptions = (options) => {
  if (!options || options.length === 0) return "—";
  if (options.length <= 3) return options.join(", ");
  return `${options.slice(0, 3).join(", ")} +${options.length - 3} more`;
};

export default function AdminManageFields() {
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [editingField, setEditingField] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState(null);
  const toast = useToast();

  useEffect(() => {
    loadFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFields = async () => {
    try {
      const res = await apiClient.get("/fields/member");
      setFields(res.data?.data || res.data || []);
    } catch (err) {
      console.error("Error loading fields:", err);
      toast.error("Failed to load fields");
    }
  };

  const openCreate = () => {
    setModalMode("create");
    setEditingField(null);
    setModalOpen(true);
  };

  const openEdit = (field) => {
    setModalMode("edit");
    setEditingField(field);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingField(null);
  };

  const handleSubmit = async (data) => {
    setSaving(true);
    try {
      if (modalMode === "edit") {
        await apiClient.put(`/fields/member/${editingField._id}`, data);
        toast.success("Field updated successfully.");
      } else {
        await apiClient.post("/fields/member", data);
        toast.success("Field created successfully.");
      }
      setModalOpen(false);
      setEditingField(null);
      loadFields();
    } catch (err) {
      console.error("Save field error:", err);
      toast.error(err.response?.data?.message || "Failed to save field.");
    } finally {
      setSaving(false);
    }
  };

  const toggleField = async (id) => {
    setLoading(true);
    try {
      await apiClient.patch(`/fields/member/${id}/toggle`, {});
      loadFields();
    } catch (err) {
      console.error("Toggle error:", err);
      toast.error(`Error: ${err.response?.data?.message || "Failed to toggle field"}`);
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
      toast.success("Field deleted.");
      loadFields();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete field");
    }
  };

  return (
    <div className="saas-container management-page">
      <div className="saas-page-header fields-page-header">
        <div>
          <h1>Form Fields</h1>
          <p>Manage custom fields used throughout member registration and workflows.</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <FiPlus size={15} strokeWidth={2.5} aria-hidden="true" />
          Add Field
        </button>
      </div>

      <div className="management-table-scroll">
      <div className="saas-table-container">
        <table className="saas-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Type</th>
              <th>Required</th>
              <th>Options</th>
              <th>Status</th>
              <th className="pk-col-actions" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 ? (
              <tr>
                <td colSpan="6" className="pk-empty">No custom fields added yet.</td>
              </tr>
            ) : (
              fields.map((field) => (
                <tr key={field._id}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{field.label}</td>
                  <td>{field.type}</td>
                  <td>{field.required ? "Yes" : "No"}</td>
                  <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {field.type === "dropdown" ? formatOptions(field.options) : "—"}
                  </td>
                  <td>
                    <ToggleSwitch active={field.isEnabled} onClick={() => toggleField(field._id)} disabled={loading} />
                  </td>
                  <td className="pk-col-actions">
                    <IconButton type="edit" title="Edit field" aria-label={`Edit ${field.label}`} onClick={() => openEdit(field)} />
                    <IconButton type="delete" title="Delete field" aria-label={`Delete ${field.label}`} onClick={() => confirmDelete(field._id)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>

      <FieldModal
        key={modalOpen ? `${modalMode}-${editingField?._id || "new"}` : "closed"}
        isOpen={modalOpen}
        mode={modalMode}
        initialData={editingField}
        saving={saving}
        onSubmit={handleSubmit}
        onClose={closeModal}
      />

      {deleteModalOpen && (
        <div className="modal-shell" onClick={() => setDeleteModalOpen(false)}>
          <div className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-field-title" onClick={(e) => e.stopPropagation()}>
            <div className="confirmation-dialog-header">
              <h3 id="delete-field-title" className="confirmation-dialog-title">Delete Field?</h3>
              <button type="button" className="icon-close-btn confirmation-dialog-close" onClick={() => setDeleteModalOpen(false)} aria-label="Close delete field dialog" title="Close">×</button>
            </div>
            <p className="confirmation-dialog-body">This action cannot be undone. Are you sure you want to permanently delete this field?</p>
            <div className="confirmation-dialog-actions">
              <button onClick={() => setDeleteModalOpen(false)} className="btn-secondary min-h-0 px-4 py-2">Cancel</button>
              <button onClick={deleteField} className="btn-danger min-h-0 px-4 py-2">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}