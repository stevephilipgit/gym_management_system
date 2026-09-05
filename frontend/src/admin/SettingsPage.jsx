/**
 * SettingsPage.jsx
 * Extended admin settings page — Black + Gold premium theme.
 * Covers: Attendance, Business Info, Enquiry Settings, Branch Config,
 * Social Links, Integrations.
 * Reuses existing save/fetch pattern for zero-regression risk.
 */
import { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';
import ToggleSwitch from './components/ui/ToggleSwitch';
import { getStoredTheme, applyTheme } from '../theme.js';
import { useToast } from '../components/shared/ToastProvider';

const SECTION_TABS = [
  { id: 'attendance', label: '⏱ Attendance' },
  { id: 'business',   label: '🏢 Business Info' },
  { id: 'branches',   label: '📍 Branches' },
  { id: 'social',     label: '🔗 Social' },
];

// All fields allowed to be saved per section
const SECTION_FIELDS = {
  attendance: [
    'oneVisitPerDay', 'duplicatePunchSeconds', 'latePunchThreshold',
    'openingTime', 'closingTime', 'blockExpiredMembers', 'expiredGraceDays', 'soundEnabled',
  ],
  business: ['gym_name', 'gym_tagline', 'support_phone', 'whatsapp_number', 'public_email', 'footer_text'],
  branches: [
    'branch_mathur_name', 'branch_mathur_address', 'branch_mathur_phone',
    'branch_mathur_map_url', 'branch_mathur_image_url',
    'branch_vepery_name', 'branch_vepery_address', 'branch_vepery_phone',
    'branch_vepery_map_url', 'branch_vepery_image_url',
  ],
  social: ['social_instagram', 'social_facebook', 'social_youtube', 'social_google_reviews'],
};

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [activeTab, setActiveTab] = useState('attendance');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    try {
      const res = await apiClient.get('/settings');
      if (res.data.settings) setSettings(res.data.settings);
    } catch {
      toast.error('Failed to load settings');
    }
  };

  const handleChange = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const saveSection = async (section) => {
    setLoading(true);
    try {
      const fields = SECTION_FIELDS[section] || [];
      const updates = {};
      for (const f of fields) {
        if (settings[f] !== undefined) updates[f] = settings[f];
      }

      await apiClient.put('/settings', updates);
      toast.success('Settings saved successfully');
    } catch {
      toast.error('Error saving settings');
    } finally {
      setLoading(false);
    }
  };

  if (!settings) {
    return (
      <div className="p-6 text-center" style={{ color: 'var(--text-muted)', paddingTop: 80 }}>
        Loading settings...
      </div>
    );
  }

  return (
    <div className="saas-container">
      <div className="saas-header">
        <h1>System Settings</h1>
        <p>All changes take effect immediately. Last updated: {settings.updatedAt ? new Date(settings.updatedAt).toLocaleString('en-GB') : 'Never'}</p>
      </div>

      {/* Tab Bar */}
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 24,
        borderBottom: '1px solid var(--border-color)', paddingBottom: 0,
      }}>
        {SECTION_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 18px',
              background: activeTab === tab.id ? 'var(--accent)' : 'transparent',
              color: activeTab === tab.id ? '#000' : 'var(--text-secondary)',
              border: 'none', borderRadius: '8px 8px 0 0',
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: 13, cursor: 'pointer',
              transition: 'all 0.15s',
              marginBottom: -1,
              borderBottom: activeTab === tab.id ? 'none' : '1px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── ATTENDANCE TAB ─────────────────────────────────── */}
      {activeTab === 'attendance' && (
        <div>
          <div style={gridStyle}>
            <Card title="🕐 Business Hours">
              <Field label="Opening Time (HH:MM)" help="Attendance blocked before this time">
                <input type="time" style={inputStyle} value={settings.openingTime || '04:00'} onChange={(e) => handleChange('openingTime', e.target.value)} />
              </Field>
              <Field label="Closing Time (HH:MM)" help="Attendance blocked after this time">
                <input type="time" style={inputStyle} value={settings.closingTime || '22:00'} onChange={(e) => handleChange('closingTime', e.target.value)} />
              </Field>
              <Field label="Late Entry Threshold (HH:MM)" help='First entry after this time marked "Late"'>
                <input type="time" style={inputStyle} value={settings.latePunchThreshold || '21:00'} onChange={(e) => handleChange('latePunchThreshold', e.target.value)} />
              </Field>
            </Card>

            <Card title="🔒 Attendance Rules">
              <ToggleField label="One Visit Per Day Only" value={settings.oneVisitPerDay} onChange={(v) => handleChange('oneVisitPerDay', v)} />
              <Field label="Duplicate Punch Prevention (seconds)" help="Block duplicate punches within this window (5–300s)">
                <input type="number" style={inputStyle} value={settings.duplicatePunchSeconds} min={5} max={300} onChange={(e) => handleChange('duplicatePunchSeconds', e.target.value)} />
              </Field>
            </Card>

            <Card title="👤 Membership Rules">
              <ToggleField label="Block Expired Member Entry" value={settings.blockExpiredMembers} onChange={(v) => handleChange('blockExpiredMembers', v)} />
              <Field label="Grace Period for Expired (days)" help="Allow entry for N days after expiry (0 = no grace)">
                <input type="number" style={inputStyle} value={settings.expiredGraceDays} min={0} max={30} onChange={(e) => handleChange('expiredGraceDays', e.target.value)} />
              </Field>
            </Card>

            <Card title="🔊 Front Desk UX">
              <ToggleField label="Enable Success / Error Sounds" value={settings.soundEnabled} onChange={(v) => handleChange('soundEnabled', v)} />
              <ThemeControl />
              <InfoBox>Sounds help receptionist quickly identify punch success/failure at the front desk.</InfoBox>
            </Card>
          </div>
          <SaveRow onSave={() => saveSection('attendance')} onReset={fetchSettings} loading={loading} />

          {/* Status Guide */}
          <div style={{ marginTop: 24, ...cardStyle }}>
            <h2 style={cardTitleStyle}>Status Guide</h2>
            {[
              { label: 'YET TO VISIT', bg: '#1a1a1a', color: '#818181', desc: 'Before first entry today' },
              { label: 'INSIDE GYM', bg: '#001a0d', color: '#3ddc84', desc: 'After check-in, before check-out' },
              { label: 'VISITED', bg: '#001029', color: '#6ca8ff', desc: 'After check-out or auto-closed' },
              { label: 'LATE', bg: '#1a0800', color: '#ffb800', desc: 'First entry after late threshold' },
            ].map((s) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}`, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>
                  {s.label}
                </span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{s.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── BUSINESS INFO TAB ──────────────────────────────── */}
      {activeTab === 'business' && (
        <div>
          <Card title="🏢 Business Information">
            <Field label="Gym Name">
              <input style={inputStyle} value={settings.gym_name || ''} onChange={(e) => handleChange('gym_name', e.target.value)} maxLength={100} />
            </Field>
            <Field label="Tagline">
              <input style={inputStyle} value={settings.gym_tagline || ''} onChange={(e) => handleChange('gym_tagline', e.target.value)} maxLength={200} />
            </Field>
            <Field label="Support Phone">
              <input style={inputStyle} value={settings.support_phone || ''} onChange={(e) => handleChange('support_phone', e.target.value)} maxLength={20} />
            </Field>
            <Field label="WhatsApp Number" help="Include country code, no spaces or + (e.g. 919342393935)">
              <input style={inputStyle} value={settings.whatsapp_number || ''} onChange={(e) => handleChange('whatsapp_number', e.target.value)} maxLength={20} />
            </Field>
            <Field label="Public Email">
              <input style={inputStyle} type="email" value={settings.public_email || ''} onChange={(e) => handleChange('public_email', e.target.value)} maxLength={120} />
            </Field>
            <Field label="Footer Text">
              <textarea style={{ ...inputStyle, height: 80, resize: 'vertical' }} value={settings.footer_text || ''} onChange={(e) => handleChange('footer_text', e.target.value)} maxLength={300} />
            </Field>
          </Card>
          <SaveRow onSave={() => saveSection('business')} onReset={fetchSettings} loading={loading} />
        </div>
      )}

      {/* ── BRANCHES TAB ───────────────────────────────────── */}
      {activeTab === 'branches' && (
        <div>
          {[
            { prefix: 'mathur', title: '📍 Branch: Mathur (Flagship)' },
            { prefix: 'vepery', title: '📍 Branch: Vepery (Central Chennai)' },
          ].map(({ prefix, title }) => (
            <Card key={prefix} title={title} style={{ marginBottom: 20 }}>
              <Field label="Branch Name">
                <input style={inputStyle} value={settings[`branch_${prefix}_name`] || ''} onChange={(e) => handleChange(`branch_${prefix}_name`, e.target.value)} maxLength={100} />
              </Field>
              <Field label="Address">
                <textarea style={{ ...inputStyle, height: 72, resize: 'vertical' }} value={settings[`branch_${prefix}_address`] || ''} onChange={(e) => handleChange(`branch_${prefix}_address`, e.target.value)} maxLength={300} />
              </Field>
              <Field label="Phone">
                <input style={inputStyle} value={settings[`branch_${prefix}_phone`] || ''} onChange={(e) => handleChange(`branch_${prefix}_phone`, e.target.value)} maxLength={20} />
              </Field>
              <Field label="Google Maps URL">
                <input style={inputStyle} value={settings[`branch_${prefix}_map_url`] || ''} onChange={(e) => handleChange(`branch_${prefix}_map_url`, e.target.value)} maxLength={500} />
              </Field>
              <Field label="Image URL">
                <input style={inputStyle} value={settings[`branch_${prefix}_image_url`] || ''} onChange={(e) => handleChange(`branch_${prefix}_image_url`, e.target.value)} maxLength={500} />
              </Field>
            </Card>
          ))}
          <SaveRow onSave={() => saveSection('branches')} onReset={fetchSettings} loading={loading} />
        </div>
      )}

      {/* ── SOCIAL LINKS TAB ───────────────────────────────── */}
      {activeTab === 'social' && (
        <div>
          <Card title="🔗 Social & Review Links">
            {[
              { key: 'social_instagram', label: 'Instagram URL' },
              { key: 'social_facebook', label: 'Facebook URL' },
              { key: 'social_youtube', label: 'YouTube URL' },
              { key: 'social_google_reviews', label: 'Google Reviews URL' },
            ].map(({ key, label }) => (
              <Field key={key} label={label}>
                <input style={inputStyle} type="url" value={settings[key] || ''} onChange={(e) => handleChange(key, e.target.value)} maxLength={300} placeholder="https://..." />
              </Field>
            ))}
          </Card>
          <SaveRow onSave={() => saveSection('social')} onReset={fetchSettings} loading={loading} />
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ title, children, style = {} }) {
  return (
    <div style={{ ...cardStyle, marginBottom: 20, ...style }}>
      <h2 style={cardTitleStyle}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, help, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {help && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{help}</p>}
    </div>
  );
}

function ToggleField({ label, value, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
      <ToggleSwitch active={value} onClick={(val) => onChange(val)} />
      <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{label}</span>
    </label>
  );
}

function InfoBox({ children, type = 'info' }) {
  const colors = {
    info:    { bg: 'rgba(108,168,255,0.08)', border: '#6ca8ff', text: '#6ca8ff' },
    warning: { bg: 'rgba(255,184,0,0.08)',   border: '#ffb800', text: '#ffb800' },
  };
  const c = colors[type] || colors.info;
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      padding: '10px 14px', borderRadius: 8, fontSize: 12, marginTop: 8,
    }}>
      {children}
    </div>
  );
}

function ThemeControl() {
  const [theme, setTheme] = useState(getStoredTheme());

  const changeTheme = (next) => {
    applyTheme(next);
    setTheme(next);
  };

  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
        Theme
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        {['light', 'dark'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => changeTheme(t)}
            aria-pressed={theme === t}
            style={{
              flex: 1,
              padding: '8px 0',
              background: theme === t ? 'var(--accent)' : 'transparent',
              color: theme === t ? '#000' : 'var(--text-secondary)',
              border: `1px solid ${theme === t ? 'var(--accent)' : 'var(--border-color)'}`,
              borderRadius: 6,
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              textTransform: 'capitalize',
              transition: 'all 0.15s',
            }}
          >
            {t === 'light' ? '☀️ Light' : '🌙 Dark'}
          </button>
        ))}
      </div>
    </div>
  );
}

function SaveRow({ onSave, onReset, loading }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
      <button
        onClick={onSave}
        disabled={loading}
        style={{
          padding: '10px 22px', background: 'var(--accent)', color: '#000',
          border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14,
          cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Saving...' : '💾 Save Settings'}
      </button>
      <button
        onClick={onReset}
        style={{
          padding: '10px 22px', background: 'transparent', color: 'var(--text-secondary)',
          border: '1px solid var(--border-color)', borderRadius: 8, fontWeight: 600,
          fontSize: 14, cursor: 'pointer',
        }}
      >
        ↺ Reset
      </button>
    </div>
  );
}

const cardStyle = {
  background: 'transparent',
  border: '1px solid var(--row-even)',
  borderRadius: 8,
  padding: '24px',
};

const cardTitleStyle = {
  fontSize: '1rem',
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: 18,
  marginTop: 0,
};

const inputStyle = {
  width: '100%',
  height: '38px',
  padding: '0 12px',
  background: 'var(--surface-muted)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 20,
};
