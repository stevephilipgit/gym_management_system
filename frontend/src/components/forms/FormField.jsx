// components/forms/FormField.jsx — label + control + inline error
export default function FormField({ label, required, error, hint, children }) {
  return (
    <div className="register-field" style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
      <label className="register-field-label" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
        {label} {required && <span style={{ color: '#e11d48' }}>*</span>}
      </label>
      {children}
      {hint && !error && <span className="register-field-hint" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{hint}</span>}
      {error && <span className="register-field-error" role="alert" style={{ fontSize: '12px', color: '#e11d48' }}>{error}</span>}
    </div>
  );
}
