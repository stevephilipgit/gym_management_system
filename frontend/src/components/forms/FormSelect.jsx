// components/forms/FormSelect.jsx — dropdown
export default function FormSelect({ name, value, onChange, placeholder, error, children, ...rest }) {
  return (
    <select
      name={name}
      value={value ?? ""}
      onChange={onChange}
      className="saas-input"
      aria-invalid={error ? "true" : undefined}
      style={{ width: "100%", ...(error ? { borderColor: "#e11d48" } : {}) }}
      {...rest}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {children}
    </select>
  );
}