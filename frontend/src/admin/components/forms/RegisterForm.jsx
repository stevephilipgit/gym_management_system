import { useEffect, useState } from "react";
import apiClient, { API_BASE_URL } from "../../../utils/apiClient.js";
import { allowedGendersForScope } from "../../../utils/scopeGenders.js";

export default function RegisterForm({ defaultData = {}, onSubmit, buttonLabel = "Submit" }) {
  const [dynamicFields, setDynamicFields] = useState([]);
  const [customFields, setCustomFields] = useState({});
  const [form, setForm] = useState({
    fullName: "",
    fatherName: "",
    dob: "",
    bloodGroup: "",
    gender: "Male",
    medicalIssues: "",
    address: "",
    aadhar: "",
    occupation: "",
    phone: "",
    trainingType: "",
    photo: null,
    photoUrl: "",
  });
  const [adminScope, setAdminScope] = useState("all");

  const SYSTEM_KEYS = [
    "gender",
    "phone",
    "aadhar",
    "dob",
    "fullName",
    "fatherName",
    "bloodGroup",
    "address",
    "occupation",
    "trainingType",
  ];

  useEffect(() => {
    const loadDynamicFields = async () => {
      try {
        const res = await apiClient.get("/fields/member");
        setDynamicFields(res.data?.data || res.data || []);
      } catch (err) {
        console.log("Failed to load dynamic fields");
      }
    };

    loadDynamicFields();

    // Refresh when user returns to this tab after toggling fields in ManageFields
    const handleVisibility = () => {
      if (!document.hidden) loadDynamicFields();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    const loadDynamicFields = async () => {
      try {
        const res = await apiClient.get("/fields/member");
        setDynamicFields(res.data?.data || res.data || []);
      } catch (err) {
        console.log("Failed to load dynamic fields");
      }
    };

    loadDynamicFields();

    // Refresh when user returns to this tab after toggling fields in ManageFields
    const handleVisibility = () => {
      if (!document.hidden) loadDynamicFields();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    if (defaultData?.customFields) {
      setCustomFields(defaultData.customFields);
    }
  }, [defaultData]);

  useEffect(() => {
    const fetchAdminScope = async () => {
      try {
        const res = await apiClient.get("/admin/me");
        const admin = res.data?.admin || res.data?.data || res.data || null;
        if (admin && admin.scope) {
          setAdminScope(admin.scope);
        }
      } catch (err) {
        console.log("Failed to fetch admin scope:", err);
      }
    };
    fetchAdminScope();
  }, [defaultData]);

  useEffect(() => {
    if (defaultData && Object.keys(defaultData).length > 0) {
      setForm((prev) => ({
        ...prev,
        fullName: defaultData.fullName || "",
        fatherName: defaultData.fatherName || "",
        dob: defaultData.dob?.substring(0, 10) || "",
        bloodGroup: defaultData.bloodGroup || "",
        gender: defaultData.gender || "Male",
        medicalIssues: defaultData.medicalIssues || "",
        address: defaultData.address || "",
        aadhar: defaultData.aadhar || "",
        occupation: defaultData.occupation || "",
        phone: defaultData.phone || "",
        trainingType: defaultData.trainingType || "",
        photoUrl: defaultData.photoUrl || "",
      }));
    }
  }, [defaultData]);

  const updateField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const updateCustomField = (key, value) => {
    setCustomFields((prev) => ({ ...prev, [key]: value }));
  };

  const validateForm = () => {
    if (!form.fullName.trim()) return "Full Name required";
    if (!form.fatherName.trim()) return "Father Name required";
    if (!form.address.trim()) return "Address required";
    if (!form.trainingType) return "Training Type required";
    if (!form.dob) return "Date of Birth required";
    if (!form.bloodGroup) return "Blood Group required";
    if (form.aadhar.replace(/\D/g, "").length !== 12) return "Aadhar must be 12 digits";
    if (form.occupation.trim() === "") return "Occupation is required";
    if (!/^[6-9]\d{9}$/.test(form.phone)) return "Phone must start with 6-9 and contain 10 digits";

    for (const field of dynamicFields) {
      if (field.required && field.isEnabled && !SYSTEM_KEYS.includes(field.key) && !customFields[field.key]) {
        return `${field.label} is required`;
      }
    }
    return null;
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setForm((prev) => ({ ...prev, photo: file, photoUrl: previewUrl }));
  };

  const submitForm = (e) => {
    e.preventDefault();
    const error = validateForm();
    if (error) {
      alert(error);
      return;
    }
    // Include the version for optimistic concurrency protection.
    onSubmit({ ...form, customFields, version: defaultData.version });
  };

  return (
    <form onSubmit={submitForm} className="panel">
      <div className="section-heading mb-6">
        <span className="eyebrow">Member Form</span>
        <h3 className="panel-title">Member details</h3>
      </div>

      <div className="form-grid-3">
        <div className="lg:col-span-2 grid gap-6 md:grid-cols-2">
          <Field label="Full Name">
            <input value={form.fullName} onChange={(e) => updateField("fullName", e.target.value)} className="field-control" />
          </Field>

          <Field label="Father's Name">
            <input value={form.fatherName} onChange={(e) => updateField("fatherName", e.target.value)} className="field-control" />
          </Field>

          <Field label="Date of Birth">
            <input type="date" value={form.dob} onChange={(e) => updateField("dob", e.target.value)} className="field-control" />
          </Field>

          <Field label="Blood Group">
            <select value={form.bloodGroup} onChange={(e) => updateField("bloodGroup", e.target.value)} className="field-control">
              <option value="">Select</option>
              <option>A+</option>
              <option>A-</option>
              <option>B+</option>
              <option>B-</option>
              <option>O+</option>
              <option>O-</option>
              <option>AB+</option>
              <option>AB-</option>
            </select>
          </Field>

          <Field label="Gender">
            <select value={form.gender} onChange={(e) => updateField("gender", e.target.value)} className="field-control">
              <option value="">Select</option>
              {allowedGendersForScope(adminScope).map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </Field>

          <Field label="Aadhar Number">
            <input
              maxLength="12"
              value={form.aadhar}
              onChange={(e) => updateField("aadhar", e.target.value.replace(/\D/g, ""))}
              className="field-control"
            />
          </Field>

          <Field label="Phone">
            <input
              maxLength="10"
              value={form.phone}
              onChange={(e) => updateField("phone", e.target.value.replace(/\D/g, ""))}
              className="field-control"
            />
          </Field>

          <Field label="Occupation">
            <input value={form.occupation} onChange={(e) => updateField("occupation", e.target.value)} className="field-control" />
          </Field>

          <div className="md:col-span-2">
            <Field label="Address">
              <textarea value={form.address} onChange={(e) => updateField("address", e.target.value)} className="field-control" />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field label="Medical Issues">
              <textarea value={form.medicalIssues} onChange={(e) => updateField("medicalIssues", e.target.value)} className="field-control" />
            </Field>
          </div>

          {dynamicFields
            .filter((field) => !SYSTEM_KEYS.includes(field.key) && field.isEnabled)
            .map((field) => (
              <Field
                key={field._id}
                label={`${field.label}${field.required ? " *" : ""}`}
              >
                {field.type === "dropdown" ? (
                  <select
                    value={customFields[field.key] || ""}
                    onChange={(e) => updateCustomField(field.key, e.target.value)}
                    className="field-control"
                    required={field.required}
                  >
                    <option value="">Select</option>
                    {field.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type || "text"}
                    value={customFields[field.key] || ""}
                    onChange={(e) => updateCustomField(field.key, e.target.value)}
                    className="field-control"
                    required={field.required}
                  />
                )}
              </Field>
            ))}

          <Field label="Training Type">
            <select value={form.trainingType} onChange={(e) => updateField("trainingType", e.target.value)} className="field-control">
              <option value="">Select Type</option>
              <option>Weight Gain</option>
              <option>Weight Loss</option>
              <option>Transformation</option>
            </select>
          </Field>
        </div>

        <div className="field-group">
          <label className="field-label">Upload Photo</label>
          <input type="file" accept="image/jpeg,image/png" onChange={handlePhotoUpload} className="field-control" />
          {form.photoUrl && (
            <div className="image-preview">
              <img
                src={form.photoUrl.startsWith("http") ? form.photoUrl : `${API_BASE_URL.replace(/\/api$/, "")}${form.photoUrl}`}
                alt="preview"
                className="h-full w-full"
              />
            </div>
          )}
        </div>
      </div>

      <button type="submit" className="btn-primary mt-6 w-full">
        {buttonLabel}
      </button>
    </form>
  );
}

function Field({ label, children }) {
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
