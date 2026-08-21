import { useEffect, useRef, useState } from "react";
import { DietSelector } from "./components/DietSelector";
import apiClient from "../utils/apiClient.js";
import { downloadMembershipInvoice } from "./utils/invoicePdf.js";

export default function AdminRegister() {
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
    gymPlan: "",
    trainingType: "",
    selectedPrice: 0,
  });

  const SYSTEM_KEYS = [
    "fullName",
    "fatherName",
    "dob",
    "bloodGroup",
    "gender",
    "medicalIssues",
    "address",
    "aadhar",
    "occupation",
    "phone",
    "trainingType",
    "gymPlan",
  ];

  const [dynamicFields, setDynamicFields] = useState([]);
  const [customFields, setCustomFields] = useState({});
  const [packages, setPackages] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("paid");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [includeDiet, setIncludeDiet] = useState(false);
  const [selectedDietId, setSelectedDietId] = useState(null);
  const [selectedDietName, setSelectedDietName] = useState(null);
  const [selectedDietDescription, setSelectedDietDescription] = useState("");
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [registerSuccessMessage, setRegisterSuccessMessage] = useState("");
  const fetchedRef = useRef(false);

  const loadDynamicFields = async () => {
    try {
      const res = await apiClient.get("/fields/member");
      setDynamicFields(res.data?.data || res.data || []);
    } catch (err) {
      console.log("Failed loading dynamic fields", err);
    }
  };

  const loadPackages = async () => {
    try {
      const res = await apiClient.get("/packages");
      setPackages(res.data?.data || res.data || []);
    } catch (err) {
      console.log("Failed loading packages:", err);
      setPackages([]);
    }
  };

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadPackages();
    loadDynamicFields();
    loadCurrentAdmin();

    // Refresh dynamic fields when user returns to this tab (e.g. after toggling in ManageFields)
    const handleVisibilityChange = () => {
      if (!document.hidden) loadDynamicFields();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const loadCurrentAdmin = async () => {
    try {
      const res = await apiClient.get("/admin/me");
      const admin = res.data?.admin || res.data?.data || res.data || null;
      setCurrentAdmin(admin);
      // Default the gender field to the first gender allowed by this admin's
      // scope. Superadmin defaults to Male (legacy behavior preserved).
      const allowed = admin?.scope
        ? {
            all: ["Male", "Female", "Transgender"],
            male: ["Male"],
            female_plus_transgender: ["Female", "Transgender"],
          }[admin.scope] || ["Male", "Female", "Transgender"]
        : ["Male", "Female", "Transgender"];
      if (allowed.length === 1) {
        setForm((prev) => ({ ...prev, gender: allowed[0] }));
      }
    } catch (err) {
      console.log("Failed loading admin", err);
    }
  };

  // Genders the current admin may register (mirrors backend scopeResolver).
  const allowedGenders = currentAdmin?.scope
    ? {
        all: ["Male", "Female", "Transgender"],
        male: ["Male"],
        female_plus_transgender: ["Female", "Transgender"],
      }[currentAdmin.scope] || ["Male", "Female", "Transgender"]
    : ["Male", "Female", "Transgender"];

  useEffect(() => {
    if (!form.gymPlan || !form.trainingType) return;
    const pkg = packages.find((item) => item._id === form.gymPlan);
    if (!pkg) return;

    const trainingMap = {
      WeightLoss: pkg.priceWeightLoss,
      WeightGain: pkg.priceWeightGain,
      Transformation: pkg.priceTransformation,
    };

    setForm((prev) => ({ ...prev, selectedPrice: trainingMap[form.trainingType] || 0 }));
  }, [form.gymPlan, form.trainingType, packages]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleCustomFieldChange = (key, value) => {
    setCustomFields((prev) => ({ ...prev, [key]: value }));
  };

  const validateForm = () => {
    const errors = {};
    if (!form.fullName.trim()) errors.fullName = "Full Name is required";
    if (!form.fatherName.trim()) errors.fatherName = "Father Name is required";
    if (!form.occupation.trim()) errors.occupation = "Occupation is required";
    if (!form.address.trim()) errors.address = "Address is required";
    if (!form.trainingType) errors.trainingType = "Training type is required";
    if (!form.dob) errors.dob = "Date of birth is required";
    if (!form.bloodGroup) errors.bloodGroup = "Blood group is required";
    if (!form.gymPlan) errors.gymPlan = "Gym plan is required";

    const pkgExists = packages.find((item) => item._id === form.gymPlan);
    if (form.gymPlan && !pkgExists) errors.gymPlan = "Invalid package selected";
    if (form.aadhar.replace(/\D/g, "").length !== 12) errors.aadhar = "Aadhar must be 12 digits";
    if (!/^[6-9]\d{9}$/.test(form.phone)) errors.phone = "Phone must start with 6-9 and be 10 digits";

    for (const field of dynamicFields) {
      if (field.required && field.isEnabled && !SYSTEM_KEYS.includes(field.key) && !String(customFields[field.key] || "").trim()) {
        errors[field.key] = `${field.label} is required`;
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const isFormValidForSubmit = () => {
    if (!form.fullName.trim()) return false;
    if (!form.fatherName.trim()) return false;
    if (!form.occupation.trim()) return false;
    if (!form.address.trim()) return false;
    if (!form.trainingType || !form.dob || !form.bloodGroup || !form.gymPlan) return false;
    if (form.aadhar.replace(/\D/g, "").length !== 12) return false;
    if (!/^[6-9]\d{9}$/.test(form.phone)) return false;

    for (const field of dynamicFields) {
      if (field.required && field.isEnabled && !SYSTEM_KEYS.includes(field.key) && !String(customFields[field.key] || "").trim()) {
        return false;
      }
    }
    return true;
  };

  const openPopup = (e) => {
    e.preventDefault();
    const ok = validateForm();
    if (!ok) return;
    setShowPopup(true);
  };

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const submitRegistration = async () => {
    setSubmitError(null);
    setSubmitting(true);

    try {
      const fd = new FormData();
      const trainingTypeMap = {
        WeightLoss: "Weight Loss",
        WeightGain: "Weight Gain",
        Transformation: "Transformation",
      };

      const selectedPackage = packages.find((item) => item._id === form.gymPlan);
      if (!selectedPackage) {
        setSubmitError("Invalid package selected");
        setSubmitting(false);
        return;
      }

      const planLabel = selectedPackage.months === 1 ? "1 Month" : `${selectedPackage.months} Months`;

      fd.append("fullName", form.fullName.trim());
      fd.append("fatherName", form.fatherName.trim());
      fd.append("dob", form.dob);
      fd.append("bloodGroup", form.bloodGroup);
      fd.append("gender", form.gender);
      fd.append("medicalIssues", form.medicalIssues.trim());
      fd.append("customFields", JSON.stringify(customFields));
      fd.append("address", form.address.trim());
      fd.append("aadhar", form.aadhar.replace(/\D/g, ""));
      fd.append("occupation", form.occupation.trim());
      fd.append("phone", form.phone);
      fd.append("gymPlan", planLabel);
      fd.append("trainingType", trainingTypeMap[form.trainingType]);
      fd.append("amount", String(form.selectedPrice));

      if (includeDiet && selectedDietId) {
        fd.append("dietId", selectedDietId);
        fd.append("dietIncludedInLastBilling", "true");
      }

      fd.append("paymentStatus", paymentStatus);
      if (paymentStatus === "paid") fd.append("paymentMode", paymentMode);
      if (photo) fd.append("photo", photo);

      const response = await apiClient.post("/members/register", fd);

      const newMember = response.data?.member || response.data?.data || response.data || {};
      let selectedDiet = null;

      if (includeDiet && selectedDietId) {
        try {
          const dietResponse = await apiClient.get(`/diets/${selectedDietId}`);
          selectedDiet = dietResponse.data?.data || dietResponse.data || null;
        } catch (dietError) {
          console.log("Diet fetch failed, using selected UI data", dietError);
          selectedDiet = {
            _id: selectedDietId,
            name: selectedDietName,
            description: selectedDietDescription,
          };
        }
      }

      // Display member code after successful registration
      const memberCode = newMember.memberCode || "";
      setRegisterSuccessMessage(`Member registered successfully! Member Code: ${memberCode}`);

      downloadMembershipInvoice({
        member: {
          ...newMember,
          fullName: newMember.fullName || form.fullName,
          phone: newMember.phone || form.phone,
          gymPlan: planLabel,
          trainingType: newMember.trainingType || trainingTypeMap[form.trainingType],
          paymentMode,
        },
        mode: "registration",
        issuer: currentAdmin?.fullName || currentAdmin?.username || "Giri Gym Admin",
        planLabel,
        trainingType: newMember.trainingType || trainingTypeMap[form.trainingType],
        price: form.selectedPrice,
        validityLabel: newMember.validityEnd ? new Date(newMember.validityEnd).toLocaleDateString("en-GB") : "-",
        paymentMode: paymentStatus === "paid" ? paymentMode : "-",
        diet: selectedDiet,
      });

      // Success - reset form
      setForm({
        fullName: "",
        fatherName: "",
        dob: "",
        bloodGroup: "",
        gender: allowedGenders[0] || "Male",
        medicalIssues: "",
        address: "",
        aadhar: "",
        occupation: "",
        phone: "",
        gymPlan: "",
        trainingType: "",
        selectedPrice: 0,
      });
      setPhoto(null);
      setPhotoPreview("");
      setShowPopup(false);
      setPaymentStatus("paid");
      setPaymentMode("cash");
      setCustomFields({});
      setIncludeDiet(false);
      setSelectedDietId(null);
      setSelectedDietName(null);
      setSelectedDietDescription("");
      setSubmitError(null);
      setFieldErrors({});

      alert("Member Registered Successfully");
    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || "Registration Failed. Please try again.";
      console.error("Registration Error:", err);
      setSubmitError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="saas-container">
      <div className="saas-header">
        <h1>Register new member</h1>
        <p>Create a complete member profile, choose a package, and confirm billing.</p>
      </div>

      <form onSubmit={openPopup} style={{ background: 'var(--surface-muted)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)', marginTop: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
          <div style={{ flex: '2 1 500px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <Field label="Full Name">
              <input name="fullName" value={form.fullName} onChange={handleChange} className="saas-input" style={{ width: '100%' }} />
              {fieldErrors.fullName && <p className="text-xs text-red-600 mt-1">{fieldErrors.fullName}</p>}
            </Field>
            <Field label="Father's Name">
              <input name="fatherName" value={form.fatherName} onChange={handleChange} className="saas-input" style={{ width: '100%' }} />
              {fieldErrors.fatherName && <p className="text-xs text-red-600 mt-1">{fieldErrors.fatherName}</p>}
            </Field>
            <Field label="Date of Birth">
              <input type="date" name="dob" value={form.dob} onChange={handleChange} className="saas-input" style={{ width: '100%' }} />
              {fieldErrors.dob && <p className="text-xs text-red-600 mt-1">{fieldErrors.dob}</p>}
            </Field>
            <Field label="Blood Group">
              <select name="bloodGroup" value={form.bloodGroup} onChange={handleChange} className="saas-input" style={{ width: '100%' }}>
                <option value="">Select</option>
                {["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((bg) => (
                  <option key={bg}>{bg}</option>
                ))}
              </select>
              {fieldErrors.bloodGroup && <p className="text-xs text-red-600 mt-1">{fieldErrors.bloodGroup}</p>}
            </Field>
            <Field label="Gender">
              <select name="gender" value={form.gender} onChange={handleChange} className="saas-input" style={{ width: '100%' }}>
                {allowedGenders.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              {allowedGenders.length === 1 && (
                <p className="text-xs text-[var(--text-secondary)] mt-1">Your scope only allows {allowedGenders[0]} members.</p>
              )}
            </Field>
            <Field label="Occupation">
              <input name="occupation" value={form.occupation} onChange={handleChange} className="saas-input" style={{ width: '100%' }} />
              {fieldErrors.occupation && <p className="text-xs text-red-600 mt-1">{fieldErrors.occupation}</p>}
            </Field>
            <Field label="Aadhar">
              <input
                value={form.aadhar}
                maxLength="12"
                onChange={(e) => setForm({ ...form, aadhar: e.target.value.replace(/\D/g, "") })}
                className="saas-input" style={{ width: '100%' }}
              />
              {fieldErrors.aadhar && <p className="text-xs text-red-600 mt-1">{fieldErrors.aadhar}</p>}
            </Field>
            <Field label="Phone">
              <input
                value={form.phone}
                maxLength="10"
                onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })}
                className="saas-input" style={{ width: '100%' }}
              />
              {fieldErrors.phone && <p className="text-xs text-red-600 mt-1">{fieldErrors.phone}</p>}
            </Field>
            <Field label="Training Type">
              <select name="trainingType" value={form.trainingType} onChange={handleChange} className="saas-input" style={{ width: '100%' }}>
                <option value="">Select</option>
                <option value="WeightLoss">Weight Loss</option>
                <option value="WeightGain">Weight Gain</option>
                <option value="Transformation">Transformation</option>
              </select>
              {fieldErrors.trainingType && <p className="text-xs text-red-600 mt-1">{fieldErrors.trainingType}</p>}
            </Field>
            <Field label="Gym Plan">
              <select name="gymPlan" value={form.gymPlan} onChange={handleChange} className="saas-input" style={{ width: '100%' }}>
                <option value="">Select Package</option>
                {packages.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name} - {item.months} Months
                  </option>
                ))}
              </select>
              {fieldErrors.gymPlan && <p className="text-xs text-red-600 mt-1">{fieldErrors.gymPlan}</p>}
            </Field>

            {dynamicFields
              .filter((field) => !SYSTEM_KEYS.includes(field.key) && field.isEnabled)
              .map((field) => (
                <Field key={field._id} label={`${field.label}${field.required ? " *" : ""}`}>
                  {field.type === "dropdown" ? (
                    <select
                      value={customFields[field.key] || ""}
                      onChange={(e) => {
                        handleCustomFieldChange(field.key, e.target.value);
                        if (fieldErrors[field.key]) {
                          setFieldErrors((prev) => ({ ...prev, [field.key]: undefined }));
                        }
                      }}
                      required={field.required}
                      className="saas-input" style={{ width: '100%' }}
                    >
                      <option value="">Select</option>
                      {(field.options || []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type || "text"}
                      value={customFields[field.key] || ""}
                      onChange={(e) => {
                        handleCustomFieldChange(field.key, e.target.value);
                        if (fieldErrors[field.key]) {
                          setFieldErrors((prev) => ({ ...prev, [field.key]: undefined }));
                        }
                      }}
                      required={field.required}
                      className="saas-input" style={{ width: '100%' }}
                    />
                  )}
                  {fieldErrors[field.key] && <p className="text-xs text-red-600 mt-1">{fieldErrors[field.key]}</p>}
                </Field>
              ))}

            <div className="md:col-span-2">
              <Field label="Address">
                <textarea name="address" value={form.address} onChange={handleChange} className="saas-input" style={{ width: '100%' }} />
                {fieldErrors.address && <p className="text-xs text-red-600 mt-1">{fieldErrors.address}</p>}
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Medical Issues">
                <textarea name="medicalIssues" value={form.medicalIssues} onChange={handleChange} className="saas-input" style={{ width: '100%' }} />
              </Field>
            </div>
          </div>

          <div style={{ flex: '1 1 250px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Field label="Upload Photo">
              <input type="file" accept="image/*" onChange={handlePhoto} className="saas-input" style={{ width: '100%', padding: '6px' }} />
            </Field>
            {photoPreview && (
              <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)', marginTop: '8px' }}>
                <img src={photoPreview} alt="Member preview" style={{ width: '100%', height: 'auto', display: 'block' }} />
              </div>
            )}

            {form.selectedPrice > 0 && (
              <div style={{ background: 'var(--surface-soft)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Selected Price</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#3ddc84' }}>Rs. {form.selectedPrice}</div>
              </div>
            )}

            <label className="checkbox-row">
              <input
                type="checkbox"
                id="includeDiet"
                checked={includeDiet}
                onChange={(e) => setIncludeDiet(e.target.checked)}
                className="accent-check"
              />
              <span>Include Diet Plan</span>
            </label>

            {includeDiet && (
              <DietSelector
                trainingType={form.trainingType}
                onDietSelect={(dietId, dietName, dietDescription) => {
                  setSelectedDietId(dietId);
                  setSelectedDietName(dietName);
                  setSelectedDietDescription(dietDescription || "");
                }}
              />
            )}
          </div>
        </div>

        <button className="btn-primary" style={{ width: '100%', marginTop: '24px', padding: '12px', borderRadius: '8px', border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 700, fontSize: '15px', cursor: (!isFormValidForSubmit() || submitting) ? 'not-allowed' : 'pointer', opacity: (!isFormValidForSubmit() || submitting) ? 0.6 : 1 }} disabled={!isFormValidForSubmit() || submitting}>
          {submitting ? "Registering..." : "Register"}
        </button>
      </form>

      {showPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4">
          <div className="w-full max-w-sm rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-6 shadow-2xl border border-[var(--border-strong)]">
            <h3 className="mb-2 text-xl font-semibold">Confirm billing</h3>
            <p className="mb-6 text-[var(--text-secondary)]">Amount: Rs. {form.selectedPrice}</p>

            {submitError && (
              <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                {submitError}
              </div>
            )}

            {registerSuccessMessage && (
              <div className="mt-4 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">
                {registerSuccessMessage}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 500 }}>
                  <input type="radio" checked={paymentStatus === "paid"} onChange={() => setPaymentStatus("paid")} /> Paid
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 500 }}>
                  <input type="radio" checked={paymentStatus === "not_paid"} onChange={() => setPaymentStatus("not_paid")} /> Not Paid
                </label>
              </div>

              {paymentStatus === "paid" && (
                <Field label="Payment Mode">
                  <select className="saas-input" style={{ width: '100%' }} value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="gpay">GPay</option>
                    <option value="card">Card</option>
                  </select>
                </Field>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                <button type="button" onClick={() => setShowPopup(false)} className="btn-secondary" style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }} disabled={submitting}>
                  Cancel
                </button>
                <button type="button" onClick={submitRegistration} className="btn-primary" style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 600, cursor: 'pointer' }} disabled={submitting}>
                  {submitting ? "..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
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
