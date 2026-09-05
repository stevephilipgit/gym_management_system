import { useEffect, useState, useCallback } from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import apiClient from '../utils/apiClient.js';
import { useToast } from '../components/shared/ToastProvider';

function formatTime(date) {
  if (!date) return '--:--';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(date) {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-GB');
}

function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return '--';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function getStatusLabel(state) {
  switch (state) {
    case 'inside': return 'Inside Gym';
    case 'completed': return 'Visited';
    case 'auto_closed': return 'Visited';
    case 'late': return 'Late';
    default: return state || 'Yet to Visit';
  }
}

function getStatusClass(state) {
  switch (state) {
    case 'inside': return 'saas-badge-pill saas-badge-success';
    case 'completed':
    case 'auto_closed': return 'saas-badge-pill saas-badge-dark';
    case 'late': return 'saas-badge-pill saas-badge-warning';
    default: return 'saas-badge-pill saas-badge-dark';
  }
}

export default function AttendanceFrontDesk() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const fetchTodayLogs = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await apiClient.get(`/attendance/logs?startDate=${today}&endDate=${today}`);
      const data = res.data;
      setRecords(data.records || []);
    } catch (err) {
      console.error('Failed to fetch attendance logs:', err);
      toast.error('Failed to load attendance logs');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchTodayLogs();
    const interval = setInterval(fetchTodayLogs, 30000);
    return () => clearInterval(interval);
  }, [fetchTodayLogs]);

  const insideCount = records.filter(r => r.state === 'inside').length;
  const visitedCount = records.filter(r => r.state === 'completed' || r.state === 'auto_closed').length;
  const lateCount = records.filter(r => r.state === 'late').length;
  const totalCount = records.length;
  const showKpiValue = !(loading && records.length === 0);

  return (
    <div className="saas-container management-page">
      <div className="saas-page-header attendance-page-header">
        <div>
          <h1>Daily Attendance</h1>
          <p>Real-time member entries for today — {new Date().toLocaleDateString('en-GB')}</p>
        </div>
        <button
          className="attendance-refresh-btn"
          onClick={fetchTodayLogs}
          disabled={loading}
          title="Refresh attendance"
          aria-label="Refresh attendance"
        >
          <FiRefreshCw size={16} className={loading ? 'attendance-spin' : ''} />
        </button>
      </div>

      <section className="dash-grid dash-grid-kpis" aria-label="Attendance metrics">
        <article className="dash-kpi">
          <span className="dash-kpi-title">Inside Gym</span>
          <span className="dash-kpi-value">{showKpiValue ? insideCount : '—'}</span>
        </article>
        <article className="dash-kpi">
          <span className="dash-kpi-title">Visited</span>
          <span className="dash-kpi-value">{showKpiValue ? visitedCount : '—'}</span>
        </article>
        <article className="dash-kpi">
          <span className="dash-kpi-title">Late</span>
          <span className="dash-kpi-value">{showKpiValue ? lateCount : '—'}</span>
        </article>
        <article className="dash-kpi">
          <span className="dash-kpi-title">Total</span>
          <span className="dash-kpi-value">{showKpiValue ? totalCount : '—'}</span>
        </article>
      </section>

      <div className="management-table-scroll">
      <div className="saas-table-container attendance-table">
        <table className="saas-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Gym ID</th>
              <th>Phone</th>
              <th>Date</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && records.length === 0 ? (
              <tr>
                <td colSpan="8" className="pk-empty">Loading attendance data…</td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan="8">
                  <div className="members-empty">
                    <p className="members-empty-title">No attendance records yet</p>
                    <p className="members-empty-sub">No member entries have been recorded today.</p>
                  </div>
                </td>
              </tr>
            ) : (
              records.map((record) => (
                <tr key={record._id}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {record.memberId?.fullName || 'Unknown'}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {record.memberId?.gymId || 'N/A'}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {record.memberId?.phone || 'N/A'}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {formatDate(record.date)}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {formatTime(record.checkInTime)}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {record.checkOutTime ? formatTime(record.checkOutTime) : '--:--'}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {record.durationMin ? formatDuration(record.durationMin) : '--'}
                  </td>
                  <td>
                    <span className={getStatusClass(record.state)}>
                      {getStatusLabel(record.state)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}