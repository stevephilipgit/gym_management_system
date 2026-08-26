// components/forms/FormSection.jsx — section wrapper for the register form
export default function FormSection({ title, subtitle, children }) {
  return (
    <section className="register-section" style={{ marginBottom: '28px' }}>
      <div className="register-section-head" style={{ marginBottom: '16px' }}>
        <h3 className="register-section-title" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {title}
        </h3>
        {subtitle && <p className="register-section-subtitle" style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
