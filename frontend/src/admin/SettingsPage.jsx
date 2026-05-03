import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../utils/apiClient';
import { GoogleSheetsConnector } from '../components/GoogleSheetsConnector';

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        credentials: 'include',
      });

      const data = await res.json();
      if (data.settings) {
        setSettings(data.settings);
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      showMsg('Failed to load settings', 'error');
    }
  };

  const showMsg = (msg, type = 'error', duration = 3000) => {
    setMessage(msg);
    setMessageType(type);
    if (duration) {
      setTimeout(() => setMessage(''), duration);
    }
  };

  const handleInputChange = (field, value) => {
    setSettings({ ...settings, [field]: value });
  };

  const saveSettings = async () => {
    setLoading(true);
    try {
      const updates = {
        oneVisitPerDay: settings.oneVisitPerDay,
        duplicatePunchSeconds: parseInt(settings.duplicatePunchSeconds),
        latePunchThreshold: settings.latePunchThreshold,
        openingTime: settings.openingTime,
        closingTime: settings.closingTime,
        blockExpiredMembers: settings.blockExpiredMembers,
        expiredGraceDays: parseInt(settings.expiredGraceDays),
        soundEnabled: settings.soundEnabled,
      };

      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });

      const data = await res.json();

      if (res.ok) {
        showMsg('✓ Settings saved successfully', 'success', 2000);
      } else {
        showMsg(data.message || 'Failed to save settings', 'error');
      }
    } catch (err) {
      showMsg('Error saving settings', 'error');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (!settings) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-600">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Front Desk &amp; Attendance Settings</h1>

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gym Business Hours */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4 text-gray-800">
            🕐 Gym Business Hours
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">
                Opening Time (HH:MM):
              </label>
              <input
                type="time"
                value={settings.openingTime || '04:00'}
                onChange={(e) =>
                  handleInputChange('openingTime', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Attendance blocked before this time (default: 04:00 AM)
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">
                Closing Time (HH:MM):
              </label>
              <input
                type="time"
                value={settings.closingTime || '22:00'}
                onChange={(e) =>
                  handleInputChange('closingTime', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Attendance blocked after this time (default: 10:00 PM)
              </p>
            </div>

            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-700">
                ℹ️ Members attempting entry outside these hours will see a "Gym Closed" message. Attempts are logged.
              </p>
            </div>
          </div>
        </div>

        {/* Attendance Rules */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4 text-gray-800">
            Attendance Rules
          </h2>

          <div className="space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.oneVisitPerDay}
                onChange={(e) =>
                  handleInputChange('oneVisitPerDay', e.target.checked)
                }
                className="w-5 h-5"
              />
              <span className="text-gray-700">One Visit Per Day Only</span>
            </label>

            <div>
              <label className="block text-sm font-semibold mb-2">
                Duplicate Punch Prevention (seconds):
              </label>
              <input
                type="number"
                value={settings.duplicatePunchSeconds}
                onChange={(e) =>
                  handleInputChange('duplicatePunchSeconds', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
                min="5"
                max="300"
              />
              <p className="text-xs text-gray-500 mt-1">
                Block duplicate punches within this window (5-300 seconds)
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">
                Late Entry Threshold (HH:MM):
              </label>
              <input
                type="time"
                value={settings.latePunchThreshold}
                onChange={(e) =>
                  handleInputChange('latePunchThreshold', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                First entry after this time is marked as "Late" (default: 9:00 PM)
              </p>
            </div>
          </div>
        </div>

        {/* Membership Rules */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4 text-gray-800">
            Membership Rules
          </h2>

          <div className="space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.blockExpiredMembers}
                onChange={(e) =>
                  handleInputChange('blockExpiredMembers', e.target.checked)
                }
                className="w-5 h-5"
              />
              <span className="text-gray-700">Block Expired Members Entry</span>
            </label>

            <div>
              <label className="block text-sm font-semibold mb-2">
                Grace Period for Expired (days):
              </label>
              <input
                type="number"
                value={settings.expiredGraceDays}
                onChange={(e) =>
                  handleInputChange('expiredGraceDays', e.target.value)
                }
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
                min="0"
                max="30"
              />
              <p className="text-xs text-gray-500 mt-1">
                Allow members to attend for N days after expiry (0 = no grace)
              </p>
            </div>
          </div>
        </div>

        {/* Front Desk UX */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4 text-gray-800">
            Front Desk UX
          </h2>

          <div className="space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(e) =>
                  handleInputChange('soundEnabled', e.target.checked)
                }
                className="w-5 h-5"
              />
              <span className="text-gray-700">
                Enable Success/Error Sounds
              </span>
            </label>

            <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded">
              ℹ️ Sounds help receptionist quickly identify punch success/failure
            </p>
          </div>
        </div>

        {/* Info Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4 text-gray-800">System Info</h2>

          <div className="space-y-2 text-sm">
            <p>
              <span className="font-semibold">Last Updated:</span>{' '}
              {settings.updatedAt
                ? new Date(settings.updatedAt).toLocaleString('en-GB')
                : 'Never'}
            </p>
            <p>
              <span className="font-semibold">Version:</span> Production Ready
            </p>
            <p className="text-xs text-gray-500 mt-4">
              All changes are logged and audited. Changes take effect immediately.
            </p>
          </div>
        </div>

        {/* Status Legend */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4 text-gray-800">Status Guide</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#f3f4f6', color: '#6b7280' }}>YET TO VISIT</span>
              <span className="text-sm text-gray-600">Before first entry today</span>
            </div>
            <div className="flex items-center gap-3">
              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#dcfce7', color: '#15803d' }}>INSIDE GYM</span>
              <span className="text-sm text-gray-600">After check-in, before check-out</span>
            </div>
            <div className="flex items-center gap-3">
              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#dbeafe', color: '#1d4ed8' }}>VISITED</span>
              <span className="text-sm text-gray-600">After check-out (or auto-closed after 2hrs)</span>
            </div>
            <div className="flex items-center gap-3">
              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#fff7ed', color: '#c2410c' }}>LATE</span>
              <span className="text-sm text-gray-600">First entry after late threshold</span>
            </div>
          </div>
        </div>
      </div>

      {/* Google Sheets Connector */}
      <div className="mt-8">
        <GoogleSheetsConnector />
      </div>

      {/* Save Button */}
      <div className="mt-6 flex gap-4">
        <button
          onClick={saveSettings}
          disabled={loading}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-semibold text-lg"
        >
          {loading ? 'Saving...' : '💾 Save Settings'}
        </button>
        <button
          onClick={fetchSettings}
          className="px-6 py-3 bg-gray-400 text-white rounded-lg hover:bg-gray-500 font-semibold text-lg"
        >
          ↻ Reset
        </button>
      </div>

      <div className="mt-6 p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-500">
        <p className="text-yellow-800 text-sm">
          <span className="font-semibold">⚠️ Important:</span> Settings changes take
          effect immediately on all front-desk sessions. Inform staff of any changes.
        </p>
      </div>
    </div>
  );
}
