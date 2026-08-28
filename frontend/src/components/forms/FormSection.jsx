// components/forms/FormSection.jsx — section wrapper for the register form
export default function FormSection({ title, subtitle, children }) {
  return (
    <section className="register-section">
      <div className="register-section-head">
        <h3 className="register-section-title">{title}</h3>
        {subtitle && <p className="register-section-subtitle">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
