import { useEffect, useState, useCallback } from 'react';
import { API_BASE_URL } from '../utils/apiClient.js';

/**
 * Format time to HH:MM AM/PM
 */
function formatTime(date) {
  if (!date) return '--:--';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/**
 * Format date to DD/MM/YYYY
 */
function formatDate(date) {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-GB');
}

/**
 * Format duration minutes to readable string
 */
function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return '--';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * Get status label from state field
 */
function getStatusLabel(state) {
  switch (state) {
    case 'inside': return 'Inside Gym';
    case 'completed': return 'Visited';
    case 'auto_closed': return 'Visited';
    case 'late': return 'Late';
    default: return state || 'Yet to Visit';
  }
}

/**
 * Get status badge styles
 */
function getStatusBadge(state) {
  switch (state) {
    case 'inside':
      return { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' };
    case 'completed':
    case 'auto_closed':
      return { bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' };
    case 'late':
      return { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' };
    default:
      return { bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' };
  }
}

export default function AttendanceFrontDesk() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  const fetchTodayLogs = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const url = `${API_BASE_URL}/attendance/search/corrections?startDate=${today}&endDate=${today}`;
      
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();

      if (data.records) {
        setRecords(data.records);
      } else {
        setRecords([]);
      }
    } catch (err) {
      console.error('Failed to fetch attendance logs:', err);
      showMessage('Failed to load attendance logs', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodayLogs();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchTodayLogs, 30000);
    return () => clearInterval(interval);
  }, [fetchTodayLogs]);

  const showMessage = (msg, type = 'error', duration = 3000) => {
    setMessage(msg);
    setMessageType(type);
    if (duration) {
      setTimeout(() => setMessage(''), duration);
    }
  };

  // Count stats
  const insideCount = records.filter(r => r.state === 'inside').length;
  const visitedCount = records.filter(r => r.state === 'completed' || r.state === 'auto_closed').length;
  const lateCount = records.filter(r => r.state === 'late').length;
  const totalCount = records.length;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Daily Attendance</h1>
          <p className="text-gray-600 dark:text-gray-400">Real-time member entries for today — {new Date().toLocaleDateString('en-GB')}</p>
        </div>
        <button 
          onClick={fetchTodayLogs}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold flex items-center gap-2"
          disabled={loading}
        >
          {loading ? 'Refreshing...' : '↻ Refresh'}
        </button>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ padding: '16px 20px', borderRadius: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: '13px', color: '#16a34a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inside Gym</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>{insideCount}</div>
        </div>
        <div style={{ padding: '16px 20px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: '13px', color: '#2563eb', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Visited</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#1d4ed8', marginTop: '4px' }}>{visitedCount}</div>
        </div>
        <div style={{ padding: '16px 20px', borderRadius: '12px', background: '#fff7ed', border: '1px solid #fed7aa' }}>
          <div style={{ fontSize: '13px', color: '#ea580c', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Late</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#c2410c', marginTop: '4px' }}>{lateCount}</div>
        </div>
        <div style={{ padding: '16px 20px', borderRadius: '12px', background: '#f9fafb', border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#374151', marginTop: '4px' }}>{totalCount}</div>
        </div>
      </div>

      {message && (
        <div className={`mb-6 p-4 rounded-lg font-semibold ${
          messageType === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600 dark:text-gray-300">Name</th>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600 dark:text-gray-300">Gym ID</th>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600 dark:text-gray-300">Phone</th>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600 dark:text-gray-300">Date</th>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600 dark:text-gray-300">Check-in</th>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600 dark:text-gray-300">Check-out</th>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600 dark:text-gray-300">Duration</th>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600 dark:text-gray-300">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading && records.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-6 py-10 text-center text-gray-500 dark:text-gray-400">Loading attendance data...</td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-6 py-10 text-center text-gray-500 dark:text-gray-400">No entries recorded today yet.</td>
                </tr>
              ) : (
                records.map((record) => {
                  const badge = getStatusBadge(record.state);
                  return (
                    <tr key={record._id} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900 dark:text-white">{record.memberId?.fullName || 'Unknown'}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-blue-600 dark:text-blue-400 font-bold">
                        #{record.memberId?.gymId || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {record.memberId?.phone || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {formatDate(record.date)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {formatTime(record.checkInTime)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {record.checkOutTime ? formatTime(record.checkOutTime) : '--:--'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {record.durationMin ? formatDuration(record.durationMin) : '--'}
                      </td>
                      <td className="px-6 py-4">
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 12px',
                          borderRadius: '20px',
                          fontSize: '12px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          backgroundColor: badge.bg,
                          color: badge.color,
                          border: `1px solid ${badge.border}`,
                        }}>
                          {getStatusLabel(record.state)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
