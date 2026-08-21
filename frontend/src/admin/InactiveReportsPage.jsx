import { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';
import { downloadCSV } from './utils/attendanceHelpers';

export default function InactiveReportsPage() {
  const [members, setMembers] = useState([]);
  const [selectedDays, setSelectedDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [skip, setSkip] = useState(0);
  const [total, setTotal] = useState(0);

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
        showMsg(`Found ${data.count} inactive members`, 'success');
      } else {
        setMembers([]);
        showMsg('No members found', 'info');
      }
    } catch (err) {
      showMsg('Failed to fetch members', 'error');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInactiveMembers();
  }, [selectedDays, skip]);

  const showMsg = (msg, type = 'error', duration = 3000) => {
    setMessage(msg);
    setMessageType(type);
    if (duration) {
      setTimeout(() => setMessage(''), duration);
    }
  };

  const exportAsCSV = async () => {
    try {
      const res = await apiClient.get(
        `/reports/export/inactive?days=${selectedDays}&skip=0&limit=5000`,
        { responseType: 'text' }
      );

      downloadCSV(res.data, `inactive-${selectedDays}days-${new Date().toISOString().split('T')[0]}.csv`);
      showMsg('✓ CSV Downloaded', 'success');
    } catch (err) {
      showMsg('Export failed', 'error');
      console.error(err);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6 dark:text-black">Inactivity Reports</h1>

      {/* Filter Panel */}
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-6 mb-6">
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div>
            <label className="block text-sm font-semibold mb-2 dark:text-black">
              Show members inactive for:
            </label>
            <select
              value={selectedDays}
              onChange={(e) => {
                setSelectedDays(parseInt(e.target.value));
                setSkip(0);
              }}
              className="px-4 py-2 border rounded-lg focus:outline-none focus:border-blue-500 dark:bg-gray-800 dark:text-white dark:border-gray-700"
            >
              <option value={7}>7 days</option>
              <option value={15}>15 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>

          <button
            onClick={exportAsCSV}
            disabled={loading || members.length === 0}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 font-semibold"
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-6 p-4 rounded-lg ${
            messageType === 'success'
              ? 'bg-green-100 text-green-800'
              : messageType === 'info'
              ? 'bg-blue-100 text-blue-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {message}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">Total Inactive</p>
          <p className="text-2xl font-bold">{total}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">Showing</p>
          <p className="text-2xl font-bold">{members.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">Last 30 Days</p>
          <p className="text-2xl font-bold">
            {members.filter((m) => m.daysSinceVisit <= 30 || m.daysSinceVisit === 'Never')
              .length}
          </p>
        </div>
      </div>

      {/* Members Table */}
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow overflow-x-auto">
        {members.length === 0 ? (
          <div className="p-6 text-center text-gray-600 dark:text-gray-400">
            {loading ? 'Loading...' : 'No members found'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800 border-b dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left dark:text-black font-bold">Gym ID</th>
                <th className="px-4 py-3 text-left dark:text-black font-bold">Name</th>
                <th className="px-4 py-3 text-left dark:text-black font-bold">Phone</th>
                <th className="px-4 py-3 text-left dark:text-black font-bold">Plan</th>
                <th className="px-4 py-3 text-left dark:text-black font-bold">Days Since Visit</th>
                <th className="px-4 py-3 text-left dark:text-black font-bold">Days Left</th>
                <th className="px-4 py-3 text-left dark:text-black font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member._id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-semibold text-blue-600 dark:text-blue-400">
                    {member.gymId}
                  </td>
                  <td className="px-4 py-3 text-blue-600 dark:text-blue-400 font-semibold">{member.fullName}</td>
                  <td className="px-4 py-3 text-blue-600 dark:text-blue-400 font-semibold">{member.phone}</td>
                  <td className="px-4 py-3 text-blue-600 dark:text-blue-400 font-semibold">{member.gymPlan}</td>
                  <td className="px-4 py-3">
                    <span className="px-3 py-1 rounded-full text-white text-xs font-semibold bg-red-600">
                      {member.daysSinceVisit === 'Never'
                        ? 'Never'
                        : `${member.daysSinceVisit}d`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-3 py-1 rounded-full text-white text-xs font-semibold ${
                        member.daysLeft > 0
                          ? 'bg-green-600'
                          : member.daysLeft === 0
                          ? 'bg-yellow-600'
                          : 'bg-red-600'
                      }`}
                    >
                      {member.daysLeft > 0
                        ? `${member.daysLeft}d`
                        : member.daysLeft === 0
                        ? 'Last Day'
                        : 'Expired'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {member.status === 'active' ? (
                      <span className="text-green-600 dark:text-green-400 font-semibold">Active</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400 font-semibold">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex justify-between items-center mt-6">
          <button
            onClick={() => setSkip(Math.max(0, skip - LIMIT))}
            disabled={skip === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            ← Previous
          </button>
          <p className="text-gray-600">
            Showing {skip + 1} to {Math.min(skip + LIMIT, total)} of {total}
          </p>
          <button
            onClick={() => setSkip(skip + LIMIT)}
            disabled={skip + LIMIT >= total}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
