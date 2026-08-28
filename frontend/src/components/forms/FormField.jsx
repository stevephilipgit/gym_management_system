// components/forms/FormField.jsx — label + control + inline error
export default function FormField({ label, required, error, hint, children }) {
  return (
    <div className="register-field">
      <label className="register-field-label">
        {label} {required && <span className="register-required">*</span>}
      </label>
      {children}
      {hint && !error && <span className="register-field-hint">{hint}</span>}
      {error && <span className="register-field-error" role="alert">{error}</span>}
    </div>
  );
}
