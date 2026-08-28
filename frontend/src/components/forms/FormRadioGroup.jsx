// components/forms/FormRadioGroup.jsx — compact segmented option group
export default function FormRadioGroup({ name, value, onChange, options, inline = true }) {
  return (
    <div role="radiogroup" aria-label={name} className="register-segment">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            className={selected ? "is-selected" : ""}
            style={inline ? undefined : { flex: "1 1 100%" }}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}
