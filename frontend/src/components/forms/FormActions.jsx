// components/forms/FormActions.jsx — single primary action + subtle discard link
// The single "Register Member" button opens the final preview modal.
export default function FormActions({ label = "Register Member", onPrimary, onDiscard, submitting, disabled }) {
  return (
    <div className="register-form-actions" style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", marginTop: "8px", paddingTop: "20px", borderTop: "1px solid var(--border-color)" }}>
      {onDiscard && (
        <button
          type="button"
          onClick={onDiscard}
          disabled={submitting}
          title="Discard the saved draft"
          className="btn-secondary"
          style={{ minHeight: "0", padding: "12px 26px", fontSize: "15px", fontWeight: 700 }}
        >
          Discard draft
        </button>
      )}
      <button type="submit" onClick={onPrimary} disabled={disabled || submitting} className="btn-primary" style={{ minHeight: "0", padding: "12px 26px", fontSize: "15px", fontWeight: 700 }}>
        {submitting ? "Submitting…" : label}
      </button>
    </div>
  );
}
