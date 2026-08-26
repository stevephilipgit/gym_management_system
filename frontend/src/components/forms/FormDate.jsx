// components/forms/FormDate.jsx — date input
import FormInput from "./FormInput.jsx";

export default function FormDate({ name, value, onChange, error }) {
  return <FormInput name={name} type="date" value={value} onChange={onChange} error={error} />;
}
