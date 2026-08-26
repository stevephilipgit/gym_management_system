// components/forms/FormRadioGroup.jsx — segmented/radio option group
export default function FormRadioGroup({ name, value, onChange, options, inline = true }) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="register-radio-group"
      style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            style={{
              flex: inline ? "1 1 auto" : "1 1 100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "10px 14px",
              borderRadius: "8px",
              border: `1.5px solid ${selected ? "#3b82f6" : "var(--border-color)"}`,
              background: selected ? "rgba(59,130,246,0.08)" : "var(--surface-muted)",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: selected ? 600 : 400,
              transition: "all 0.15s ease",
            }}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
              style={{ accentColor: "#3b82f6" }}
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}
