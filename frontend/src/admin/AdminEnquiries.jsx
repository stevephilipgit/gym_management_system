/**
 * AdminEnquiries.jsx
 * Full enquiry management dashboard for admin.
 * Maintains Black + Gold premium theme of the app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../utils/apiClient';

const STATUS_COLORS = {
  new:       { bg: '#1a1a00', border: '#ccff00', text: '#ccff00' },
  contacted: { bg: '#001a0d', border: '#3ddc84', text: '#3ddc84' },
  closed:    { bg: '#1a1a1a', border: '#818181', text: '#818181' },
  spam:      { bg: '#1a0000', border: '#ff5d5d', text: '#ff5d5d' },
};

const BRANCH_OPTS = ['all', 'Mathur', 'Vepery', 'Any Branch'];
const STATUS_OPTS = ['all', 'new', 'contacted', 'closed', 'spam'];
const REASON_OPTS = [
  'all', 'Membership Plans', 'Weight Loss', 'Weight Gain',
  'Personal Training', 'Transformation', 'Pricing', 'Branch Visit',
  'General Question', 'Other',
];

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.new;
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: 1, display: 'inline-block',
    }}>
      {status}
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

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this enquiry? This cannot be undone.')) return;
    try {
      await apiClient.delete(`/enquiries/${id}`);
      setEnquiries((prev) => prev.filter((e) => e._id !== id));
      showToast('Enquiry deleted.');
    } catch (err) {
      showToast('Failed to delete enquiry.');
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
    } catch (err) {
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
    <div className="p-6">
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
            Enquiries
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            {pagination.total} total leads
          </p>
        </div>
        <button
          onClick={handleExportCSV}
          style={{
            background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 8,
            padding: '10px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          ↓ Export CSV
        </button>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20,
        padding: '16px', background: 'var(--surface-soft)', borderRadius: 12,
        border: '1px solid var(--border-color)',
      }}>
        <input
          ref={searchRef}
          type="text"
          placeholder="Search name, phone, email..."
          onChange={handleSearchInput}
          style={filterInputStyle}
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
            style={filterInputStyle}
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
          style={filterInputStyle}
          title="From date"
        />
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => handleFilterChange('dateTo', e.target.value)}
          style={filterInputStyle}
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
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-soft)', textAlign: 'left' }}>
                {['Date', 'Name', 'Phone', 'Branch', 'Reason', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enquiries.map((e, i) => (
                <tr
                  key={e._id}
                  style={{
                    background: i % 2 === 0 ? 'var(--row-odd)' : 'var(--row-even)',
                    transition: 'background 0.15s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(el) => el.currentTarget.style.background = 'var(--row-hover)'}
                  onMouseLeave={(el) => el.currentTarget.style.background = i % 2 === 0 ? 'var(--row-odd)' : 'var(--row-even)'}
                >
                  <td style={tdStyle}>{new Date(e.createdAt).toLocaleDateString('en-IN')}</td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {e.name}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{e.email}</div>
                  </td>
                  <td style={tdStyle}>{e.phone}</td>
                  <td style={tdStyle}>{e.preferred_branch}</td>
                  <td style={tdStyle}>{e.reason}</td>
                  <td style={tdStyle}><StatusBadge status={e.status} /></td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <button style={actionBtnStyle('#ccff00', '#000')} onClick={() => setSelected(e)}>
                      View
                    </button>
                    {e.status !== 'contacted' && (
                      <button style={actionBtnStyle('#3ddc84', '#000')} onClick={() => quickStatus(e._id, 'contacted')}>
                        ✓ Contacted
                      </button>
                    )}
                    {e.status !== 'closed' && (
                      <button style={actionBtnStyle('#818181', '#fff')} onClick={() => quickStatus(e._id, 'closed')}>
                        Close
                      </button>
                    )}
                    <button style={actionBtnStyle('#ff5d5d', '#fff')} onClick={() => handleDelete(e._id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const filterInputStyle = {
  padding: '8px 12px',
  background: 'var(--surface-muted)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-primary)',
  borderRadius: 8,
  fontSize: 13,
  outline: 'none',
  flex: '1 1 160px',
  minWidth: 0,
};

const thStyle = {
  padding: '10px 14px',
  color: 'var(--text-muted)',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 1,
  borderBottom: '1px solid var(--border-color)',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '12px 14px',
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-color)',
  verticalAlign: 'middle',
  maxWidth: 180,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

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
