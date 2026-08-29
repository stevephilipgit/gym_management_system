/**
 * AdminEnquiries.jsx
 * Full enquiry management dashboard for admin.
 * Maintains Black + Gold premium theme of the app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../utils/apiClient';
import IconButton from './components/ui/IconButton';

const BRANCH_OPTS = ['all', 'Mathur', 'Vepery', 'Any Branch'];
const STATUS_OPTS = ['all', 'new', 'contacted', 'closed', 'spam'];
const REASON_OPTS = [
  'all', 'Membership Plans', 'Weight Loss', 'Weight Gain',
  'Personal Training', 'Transformation', 'Pricing', 'Branch Visit',
  'General Question', 'Other',
];

function StatusBadge({ status }) {
  let badgeClass = "saas-badge-dark";
  if (status === "new") badgeClass = "saas-badge-warning";
  if (status === "contacted") badgeClass = "saas-badge-success";
  if (status === "closed") badgeClass = "saas-badge-dark";
  if (status === "spam") badgeClass = "saas-badge-danger";

  return (
    <span className={`saas-badge-pill ${badgeClass}`}>
      {status.toUpperCase()}
    </span>
  );
}

function DetailModal({ enquiry, onClose, onStatusChange }) {
  const [status, setStatus] = useState(enquiry.status);
  const [notes, setNotes] = useState(enquiry.notes || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.patch(`/enquiries/${enquiry._id}/status`, { status, notes });
      onStatusChange(enquiry._id, status, notes);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="enq-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="enq-modal" style={{ maxWidth: 560 }}>
        <div className="enq-header">
          <div>
            <p className="enq-eyebrow">Enquiry Detail</p>
            <h2 className="enq-title" style={{ fontSize: '1.2rem' }}>{enquiry.name}</h2>
          </div>
          <button className="enq-close" onClick={onClose}>✕</button>
        </div>
        <div className="enq-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px', marginBottom: 20 }}>
            {[
              ['Phone', enquiry.phone],
              ['Email', enquiry.email],
              ['Branch', enquiry.preferred_branch],
              ['Reason', enquiry.reason],
              ['Source', enquiry.source_page || 'home'],
              ['Submitted', new Date(enquiry.createdAt).toLocaleString('en-IN')],
            ].map(([label, value]) => (
              <div key={label}>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</p>
                <p style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{value}</p>
              </div>
            ))}
          </div>

          {enquiry.message && (
            <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--surface-soft)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Message / Goal</p>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{enquiry.message}</p>
            </div>
          )}

          <div className="enq-field" style={{ marginBottom: 12 }}>
            <label className="enq-label">Update Status</label>
            <select className="enq-input enq-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {['new', 'contacted', 'closed', 'spam'].map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>

          <div className="enq-field">
            <label className="enq-label">Admin Notes</label>
            <textarea
              className="enq-input enq-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add internal notes about this lead..."
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="enq-actions" style={{ marginTop: 16 }}>
            <button className="enq-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button className="enq-btn-outline" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminEnquiries() {
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [filters, setFilters] = useState({ status: 'all', branch: 'all', reason: 'all', search: '', dateFrom: '', dateTo: '' });
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [enquiryToDelete, setEnquiryToDelete] = useState(null);
  const searchRef = useRef();
  const searchTimer = useRef();

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchEnquiries = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 25, ...filters });
      const res = await apiClient.get(`/enquiries?${params}`);
      setEnquiries(res.data.enquiries || []);
      setPagination(res.data.pagination || { page: 1, pages: 1, total: 0 });
    } catch (err) {
      console.error('[Enquiries] Fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchEnquiries(1);
  }, [fetchEnquiries]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleSearchInput = (e) => {
    const val = e.target.value;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      handleFilterChange('search', val);
    }, 350);
  };

  const confirmDelete = (id) => {
    setEnquiryToDelete(id);
    setDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!enquiryToDelete) return;
    try {
      await apiClient.delete(`/enquiries/${enquiryToDelete}`);
      setEnquiries((prev) => prev.filter((e) => e._id !== enquiryToDelete));
      setDeleteModalOpen(false);
      setEnquiryToDelete(null);
      showToast('Enquiry deleted.');
    } catch {
      showToast('Failed to delete enquiry.');
      setDeleteModalOpen(false);
    }
  };

  const handleStatusChange = (id, status, notes) => {
    setEnquiries((prev) =>
      prev.map((e) => (e._id === id ? { ...e, status, notes } : e))
    );
    showToast('Status updated.');
  };

  const handleExportCSV = async () => {
    try {
      const params = new URLSearchParams(filters);
      const res = await apiClient.get(`/enquiries/export/csv?${params}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `enquiries_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Export failed.');
    }
  };

  const quickStatus = async (id, status) => {
    try {
      await apiClient.patch(`/enquiries/${id}/status`, { status });
      handleStatusChange(id, status, undefined);
    } catch {
      showToast('Update failed.');
    }
  };

  return (
    <div className="saas-container management-page">
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: '#1a1a1a', border: '1px solid #ccff00', color: '#ccff00',
          padding: '12px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600,
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div className="saas-header" style={{ marginBottom: 0 }}>
          <h1>Enquiries</h1>
          <p>Track and manage leads • {pagination.total} total</p>
        </div>
        <button onClick={handleExportCSV} className="btn-secondary" style={{ height: '38px', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px', borderRadius: '6px', fontSize: '14px', background: 'var(--surface-muted)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer' }}>
          ↓ Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="saas-filter-bar">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search name, phone, email..."
          onChange={handleSearchInput}
          className="saas-input"
          style={{ flex: '1 1 200px' }}
        />

        {[
          ['Status', 'status', STATUS_OPTS],
          ['Branch', 'branch', BRANCH_OPTS],
          ['Reason', 'reason', REASON_OPTS],
        ].map(([label, key, opts]) => (
          <select
            key={key}
            value={filters[key]}
            onChange={(e) => handleFilterChange(key, e.target.value)}
            className="saas-input"
          >
            {opts.map((o) => (
              <option key={o} value={o}>
                {o === 'all' ? `All ${label}s` : o}
              </option>
            ))}
          </select>
        ))}

        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
          className="saas-input"
          title="From date"
        />
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => handleFilterChange('dateTo', e.target.value)}
          className="saas-input"
          title="To date"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          Loading enquiries...
        </div>
      ) : enquiries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          No enquiries found for the current filters.
        </div>
      ) : (
        <div className="management-table-scroll">
        <div className="saas-table-container">
          <table className="saas-table">
            <thead>
              <tr>
                {['Date', 'Name', 'Phone', 'Branch', 'Reason', 'Status', 'Actions'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enquiries.map((e) => (
                <tr key={e._id} style={{ cursor: 'pointer' }}>
                  <td>{new Date(e.createdAt).toLocaleDateString('en-IN')}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {e.name}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>{e.email}</div>
                  </td>
                  <td>{e.phone}</td>
                  <td>{e.preferred_branch}</td>
                  <td>{e.reason}</td>
                  <td><StatusBadge status={e.status} /></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <IconButton type="view" onClick={() => setSelected(e)} />
                      {e.status !== 'contacted' && (
                        <IconButton type="check" title="Mark Contacted" onClick={() => quickStatus(e._id, 'contacted')} />
                      )}
                      {e.status !== 'closed' && (
                        <IconButton type="close" title="Close Enquiry" onClick={() => quickStatus(e._id, 'closed')} />
                      )}
                      <IconButton type="delete" onClick={() => confirmDelete(e._id)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          {Array.from({ length: pagination.pages }, (_, i) => i + 1).map((pg) => (
            <button
              key={pg}
              onClick={() => fetchEnquiries(pg)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border-color)',
                background: pg === pagination.page ? 'var(--accent)' : 'transparent',
                color: pg === pagination.page ? '#000' : 'var(--text-secondary)',
                fontWeight: 700, cursor: 'pointer', fontSize: 13,
              }}
            >
              {pg}
            </button>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selected && (
        <DetailModal
          enquiry={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatusChange}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--modal-backdrop)', zIndex: 9999 }}>
          <div className="w-full max-w-sm rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-6 shadow-2xl border border-[var(--border-strong)]" style={{ background: 'var(--surface-soft)', padding: '24px', borderRadius: '16px', border: '1px solid var(--border-strong)', width: '100%', maxWidth: '384px' }}>
            <h3 className="mb-2 text-xl font-semibold text-white" style={{ marginBottom: '8px', fontSize: '1.25rem', fontWeight: 600, color: '#fff' }}>Delete Enquiry?</h3>
            <p className="mb-6 text-[var(--text-secondary)]" style={{ marginBottom: '24px', color: 'var(--text-secondary)' }}>This action cannot be undone. Are you sure you want to delete this enquiry?</p>
            <div className="flex justify-end gap-3" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button onClick={() => setDeleteModalOpen(false)} className="btn-secondary min-h-0 px-4 py-2" style={actionBtnStyle('var(--surface-muted)', 'var(--text-primary)')}>Cancel</button>
              <button onClick={handleDelete} className="btn-danger min-h-0 px-4 py-2" style={actionBtnStyle('#ff5d5d', '#fff')}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const actionBtnStyle = (bg, color) => ({
  background: bg,
  color,
  border: 'none',
  borderRadius: 5,
  padding: '4px 10px',
  fontWeight: 700,
  fontSize: 11,
  cursor: 'pointer',
  marginRight: 4,
  transition: 'opacity 0.15s',
});
