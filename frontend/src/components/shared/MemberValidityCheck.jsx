import { useState } from 'react';
import { API_BASE_URL } from '../../utils/apiClient';
import { detectInputType } from '../../admin/utils/attendanceHelpers';

export default function MemberValidityCheck() {
  const [input, setInput] = useState('');
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e) => {
    e.preventDefault();
    
    if (!input.trim()) {
      setError('Please enter phone or gym ID');
      return;
    }

    setLoading(true);
    setError('');
    setMember(null);

    try {
      // Detect input type
      const inputType = detectInputType(input);
      
      if (!inputType) {
        setError('Invalid phone number or gym ID. Phone must be 10 digits (6-9), Gym ID must be 4+ digits');
        setLoading(false);
        return;
      }

      // Build URL with appropriate query parameter
      let url = `${API_BASE_URL}/members/public-validity`;
      if (inputType === 'phone') {
        url += `?phone=${encodeURIComponent(input)}`;
      } else {
        url += `/${encodeURIComponent(input)}`;
      }

      // Fetch member validity
      const response = await fetch(url, { credentials: 'include' });

      const data = await response.json();

      if (data.success && data.data?.found) {
        setMember(data.data);
        setError('');
      } else {
        setError(data.data?.message || data.message || 'Member not found');
        setMember(null);
      }
    } catch (err) {
      setError('Failed to fetch member details');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (daysLeft) => {
    if (daysLeft > 7) return 'bg-green-100 text-green-800';
    if (daysLeft > 0) return 'bg-yellow-100 text-yellow-800';
    if (daysLeft === 0) return 'bg-orange-100 text-orange-800';
    return 'bg-red-100 text-red-800';
  };

  const getStatusText = (daysLeft) => {
    if (daysLeft > 0) return `Active (${daysLeft} days left)`;
    if (daysLeft === 0) return 'Last Day';
    return 'Expired';
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4 dark:text-white">Check Membership Validity</h2>
      
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Enter phone (10 digits) or gym ID..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-semibold transition"
          >
            {loading ? 'Searching...' : 'Check'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-4 p-4 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-100 rounded-lg">
          {error}
        </div>
      )}

      {member && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Gym ID</p>
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{member.gymId}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Member Name</p>
              <p className="text-lg font-bold dark:text-white">{member.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Phone</p>
              <p className="text-lg font-semibold dark:text-white">{member.phone}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Plan</p>
              <p className="text-lg font-semibold dark:text-white">{member.plan}</p>
            </div>
          </div>

          <div className="border-t dark:border-gray-700 pt-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Validity Status</p>
            <div className={`inline-block px-4 py-2 rounded-lg font-bold ${getStatusColor(member.daysLeft)}`}>
              {getStatusText(member.daysLeft)}
            </div>
            {member.photoUrl && (
              <div className="mt-4">
                <img
                  src={member.photoUrl}
                  alt={member.name}
                  className="w-32 h-40 object-cover rounded-lg"
                />
              </div>
            )}
          </div>

          {member.lastVisit && (
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Last Visit: {new Date(member.lastVisit).toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {member === null && !error && !loading && (
        <div className="text-center text-gray-600 dark:text-gray-400 py-8">
          Enter your phone number or gym ID to check membership validity
        </div>
      )}
    </div>
  );
}
