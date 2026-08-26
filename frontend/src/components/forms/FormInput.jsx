// components/forms/FormInput.jsx — text/number/date/email input
export default function FormInput({ name, type = "text", value, onChange, placeholder, error, inputMode, maxLength, ...rest }) {
  return (
    <input
      name={name}
      type={type}
      value={value ?? ""}
      onChange={onChange}
      placeholder={placeholder}
      inputMode={inputMode}
      maxLength={maxLength}
      className="saas-input"
      aria-invalid={error ? "true" : undefined}
      style={{ width: "100%", ...(error ? { borderColor: "#e11d48" } : {}) }}
      {...rest}
    />
  );
}
