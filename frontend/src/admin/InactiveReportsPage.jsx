import { useEffect, useState } from 'react';
import { FiDownload } from 'react-icons/fi';
import apiClient from '../utils/apiClient';
import { downloadCSV } from './utils/attendanceHelpers';
import { useToast } from '../components/shared/ToastProvider';

export default function InactiveReportsPage() {
  const [members, setMembers] = useState([]);
  const [selectedDays, setSelectedDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [skip, setSkip] = useState(0);
  const [total, setTotal] = useState(0);
  const toast = useToast();

  const LIMIT = 50;

  const fetchInactiveMembers = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(
        `/reports/inactive?days=${selectedDays}&skip=${skip}&limit=${LIMIT}`
      );

      const data = res.data;

      if (data.members) {
        setMembers(data.members);
        setTotal(data.total);
        toast.success(`Found ${data.count} inactive members`);
      } else {
        setMembers([]);
        toast.info('No members found');
      }
    } catch (err) {
      toast.error('Failed to fetch members');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInactiveMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDays, skip]);

  const exportAsCSV = async () => {
    try {
      const res = await apiClient.get(
        `/reports/export/inactive?days=${selectedDays}&skip=0&limit=5000`,
        { responseType: 'text' }
      );

      downloadCSV(res.data, `inactive-${selectedDays}days-${new Date().toISOString().split('T')[0]}.csv`);
      toast.success('CSV Downloaded');
    } catch (err) {
      toast.error('Export failed');
      console.error(err);
    }
  };

  const last30 = members.filter((m) => m.daysSinceVisit <= 30 || m.daysSinceVisit === 'Never').length;
  const showKpiValue = !(loading && members.length === 0);

  return (
    <div className="saas-container management-page">
      <div className="saas-page-header">
        <h1>Inactivity Reports</h1>
        <p>Identify members who haven't visited recently.</p>
      </div>

      <div className="saas-filter-bar" style={{ marginBottom: '16px' }}>
        <label className="field-label" style={{ margin: 0 }}>Show inactive for</label>
        <select
          className="saas-input"
          style={{ width: '150px' }}
          value={selectedDays}
          onChange={(e) => {
            setSelectedDays(parseInt(e.target.value));
            setSkip(0);
          }}
          aria-label="Inactivity threshold"
        >
          <option value={7}>7 days</option>
          <option value={15}>15 days</option>
          <option value={30}>30 days</option>
        </select>
        <button
          className="btn-secondary min-h-0 px-4 py-2"
          style={{ marginLeft: 'auto' }}
          onClick={exportAsCSV}
          disabled={loading || members.length === 0}
          title="Export CSV"
        >
          <FiDownload size={14} />
          Export
        </button>
      </div>

      <section className="dash-grid dash-grid-kpis" aria-label="Inactivity metrics">
        <article className="dash-kpi">
          <span className="dash-kpi-title">Total Inactive</span>
          <span className="dash-kpi-value">{showKpiValue ? total : '—'}</span>
        </article>
        <article className="dash-kpi">
          <span className="dash-kpi-title">Showing</span>
          <span className="dash-kpi-value">{showKpiValue ? members.length : '—'}</span>
        </article>
        <article className="dash-kpi">
          <span className="dash-kpi-title">Last 30 Days</span>
          <span className="dash-kpi-value">{showKpiValue ? last30 : '—'}</span>
        </article>
      </section>

      <div className="management-table-scroll">
      <div className="saas-table-container">
        <table className="saas-table">
          <thead>
            <tr>
              <th>Gym ID</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Plan</th>
              <th>Days Since Visit</th>
              <th>Days Left</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && members.length === 0 ? (
              <tr>
                <td colSpan="7" className="pk-empty">Loading…</td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan="7">
                  <div className="members-empty">
                    <p className="members-empty-title">No inactive members found</p>
                    <p className="members-empty-sub">No members match the selected inactivity period.</p>
                  </div>
                </td>
              </tr>
            ) : (
              members.map((member) => (
                <tr key={member._id}>
                  <td style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {member.gymId}
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{member.fullName}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{member.phone}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{member.gymPlan}</td>
                  <td>
                    <span className={`saas-badge-pill ${member.daysSinceVisit === 'Never' ? 'saas-badge-danger' : 'saas-badge-warning'}`}>
                      {member.daysSinceVisit === 'Never' ? 'Never' : `${member.daysSinceVisit}d`}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`saas-badge-pill ${
                        member.daysLeft > 0
                          ? 'saas-badge-success'
                          : member.daysLeft === 0
                          ? 'saas-badge-warning'
                          : 'saas-badge-danger'
                      }`}
                    >
                      {member.daysLeft > 0
                        ? `${member.daysLeft}d`
                        : member.daysLeft === 0
                        ? 'Last Day'
                        : 'Expired'}
                    </span>
                  </td>
                  <td>
                    <span className={`saas-badge-pill ${member.status === 'active' ? 'saas-badge-success' : 'saas-badge-danger'}`}>
                      {member.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>

      {total > LIMIT && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <span className="text-sm text-[var(--text-secondary)]">
            Showing {skip + 1} to {Math.min(skip + LIMIT, total)} of {total}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setSkip(Math.max(0, skip - LIMIT))}
              disabled={skip === 0}
              className="saas-input"
              style={{ cursor: skip === 0 ? 'not-allowed' : 'pointer' }}
            >
              ← Prev
            </button>
            <button
              onClick={() => setSkip(skip + LIMIT)}
              disabled={skip + LIMIT >= total}
              className="saas-input"
              style={{ cursor: skip + LIMIT >= total ? 'not-allowed' : 'pointer' }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}