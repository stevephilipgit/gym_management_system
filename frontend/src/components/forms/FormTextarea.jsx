// components/forms/FormTextarea.jsx — multiline text area
export default function FormTextarea({ name, value, onChange, placeholder, error, rows = 3, ...rest }) {
  return (
    <textarea
      name={name}
      value={value ?? ""}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      className="saas-input"
      aria-invalid={error ? "true" : undefined}
      style={{ width: "100%", resize: "vertical", ...(error ? { borderColor: "#e11d48" } : {}) }}
      {...rest}
    />
  );
}
