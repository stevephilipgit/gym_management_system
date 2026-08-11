import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../utils/apiClient';
import { formatDate, formatTime, formatDuration } from './utils/attendanceHelpers';
import IconButton from './components/ui/IconButton';

export default function CorrectionPanel() {
  const [records, setRecords] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [addData, setAddData] = useState({});
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState(null);

  const searchCorrections = async () => {
    if (!searchQuery && !startDate && !endDate) {
      showMsg('Please enter search criteria', 'error');
      return;
    }

    setLoading(true);
    try {
      let url = `${API_BASE_URL}/attendance/search/corrections?`;
      if (searchQuery) url += `query=${encodeURIComponent(searchQuery)}&`;
      if (startDate) url += `startDate=${encodeURIComponent(startDate)}&`;
      if (endDate) url += `endDate=${encodeURIComponent(endDate)}&`;

      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();

      if (data.records) {
        setRecords(data.records);
        showMsg(`Found ${data.records.length} records`, 'success');
      } else {
        setRecords([]);
        showMsg(data.message || 'No records found', 'info');
      }
    } catch (err) {
      showMsg('Search failed', 'error');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const showMsg = (msg, type = 'error', duration = 3000) => {
    setMessage(msg);
    setMessageType(type);
    if (duration) {
      setTimeout(() => setMessage(''), duration);
    }
  };

  const startEdit = (record) => {
    setEditingId(record._id);
    setEditData({
      checkInTime: record.checkInTime,
      checkOutTime: record.checkOutTime,
    });
  };

  const saveEdit = async () => {
    try {
      const updateData = {};
      if (editData.checkInTime) updateData.checkInTime = editData.checkInTime;
      if (editData.checkOutTime) updateData.checkOutTime = editData.checkOutTime;

      const res = await fetch(
        `${API_BASE_URL}/attendance/${editingId}/correct-time`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updateData),
        }
      );

      const data = await res.json();

      if (res.ok) {
        // Update local record
        setRecords(
          records.map((r) => (r._id === editingId ? data.attendance : r))
        );
        showMsg('Time corrected successfully', 'success');
        setEditingId(null);
      } else {
        showMsg(data.message || 'Failed to save', 'error');
      }
    } catch (err) {
      showMsg('Error saving', 'error');
      console.error(err);
    }
  };

  const confirmDelete = (id) => {
    setRecordToDelete(id);
    setDeleteModalOpen(true);
  };

  const deleteRecord = async () => {
    if (!recordToDelete) return;

    try {
      const res = await fetch(`${API_BASE_URL}/attendance/${recordToDelete}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        setRecords(records.filter((r) => r._id !== recordToDelete));
        showMsg('Record deleted', 'success');
        setDeleteModalOpen(false);
        setRecordToDelete(null);
      } else {
        const data = await res.json();
        showMsg(data.message || 'Failed to delete', 'error');
      }
    } catch (err) {
      showMsg('Error deleting', 'error');
      console.error(err);
      setDeleteModalOpen(false);
    }
  };

  const handleAddMissing = async () => {
    if (!addData.memberId || !addData.date || !addData.checkInTime) {
      showMsg('Please fill required fields', 'error');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/attendance/add-missing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(addData),
      });

      const data = await res.json();

      if (res.ok) {
        setRecords([...records, data.attendance]);
        showMsg('Attendance added', 'success');
        setShowAddModal(false);
        setAddData({});
      } else {
        showMsg(data.message || 'Failed to add', 'error');
      }
    } catch (err) {
      showMsg('Error adding', 'error');
      console.error(err);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Attendance Corrections</h1>

      {/* Search Panel */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <input
            type="text"
            placeholder="Phone or Gym ID"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-4 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
          />
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-4 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-4 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={searchCorrections}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-semibold"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
        >
          + Add Missing Attendance
        </button>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-6 p-4 rounded-lg ${
            messageType === 'success'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {message}
        </div>
      )}

      {/* Records Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        {records.length === 0 ? (
          <div className="p-6 text-center text-gray-600">No records found</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Member</th>
                <th className="px-4 py-3 text-left">Check-in</th>
                <th className="px-4 py-3 text-left">Check-out</th>
                <th className="px-4 py-3 text-left">Duration</th>
                <th className="px-4 py-3 text-center" style={{ width: '100px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record._id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">{formatDate(record.date)}</td>
                  <td className="px-4 py-3">
                    {record.memberId?.fullName}
                    <br />
                    <span className="text-xs text-gray-500">
                      {record.memberId?.phone}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {editingId === record._id ? (
                      <input
                        type="time"
                        value={editData.checkInTime?.slice(11, 16) || ''}
                        onChange={(e) => {
                          const [h, m] = e.target.value.split(':');
                          const date = new Date(record.date);
                          date.setHours(h, m);
                          setEditData({
                            ...editData,
                            checkInTime: date.toISOString(),
                          });
                        }}
                        className="px-2 py-1 border rounded"
                      />
                    ) : (
                      formatTime(record.checkInTime)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === record._id ? (
                      <input
                        type="time"
                        value={editData.checkOutTime?.slice(11, 16) || ''}
                        onChange={(e) => {
                          const [h, m] = e.target.value.split(':');
                          const date = new Date(record.date);
                          date.setHours(h, m);
                          setEditData({
                            ...editData,
                            checkOutTime: date.toISOString(),
                          });
                        }}
                        className="px-2 py-1 border rounded"
                      />
                    ) : (
                      formatTime(record.checkOutTime) || '-'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {formatDuration(record.durationMin) || '-'}
                  </td>
                  <td className="px-4 py-3 flex gap-2 justify-center items-center">
                    {editingId === record._id ? (
                      <>
                        <button
                          onClick={saveEdit}
                          className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-2 py-1 bg-gray-400 text-white text-xs rounded hover:bg-gray-500"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <IconButton type="edit" onClick={() => startEdit(record)} />
                        <IconButton type="delete" onClick={() => confirmDelete(record._id)} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Missing Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full">
            <h2 className="text-xl font-bold mb-4">Add Missing Attendance</h2>

            <div className="space-y-4">
              <input
                type="text"
                placeholder="Member ID (Gym ID)"
                value={addData.memberId || ''}
                onChange={(e) => setAddData({ ...addData, memberId: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:border-blue-500"
              />
              <input
                type="date"
                value={addData.date || ''}
                onChange={(e) => setAddData({ ...addData, date: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:border-blue-500"
              />
              <input
                type="time"
                value={addData.checkInTime || ''}
                onChange={(e) => setAddData({ ...addData, checkInTime: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:border-blue-500"
                placeholder="Check-in Time"
              />
              <input
                type="time"
                value={addData.checkOutTime || ''}
                onChange={(e) => setAddData({ ...addData, checkOutTime: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:border-blue-500"
                placeholder="Check-out Time (optional)"
              />
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleAddMissing}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-semibold"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setAddData({});
                }}
                className="flex-1 px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500 font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4">
          <div className="w-full max-w-sm rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-6 shadow-2xl border border-[var(--border-strong)]">
            <h3 className="mb-2 text-xl font-semibold text-white">Delete Record?</h3>
            <p className="mb-6 text-[var(--text-secondary)]">This action cannot be undone. Are you sure you want to delete this attendance record?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteModalOpen(false)} className="btn-secondary min-h-0 px-4 py-2">Cancel</button>
              <button onClick={deleteRecord} className="btn-danger min-h-0 px-4 py-2">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
