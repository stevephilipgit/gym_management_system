import { useEffect, useRef, useState } from "react";
import { DietSelector } from "./components/DietSelector";
import apiClient from "../utils/apiClient.js";
import { allowedGendersForScope, defaultGenderForScope } from "../utils/scopeGenders.js";
import { downloadMembershipInvoice } from "./utils/invoicePdf.js";
import { useAdmin } from "./authContext.js";
import {
  FormSection,
  FormField,
  FormInput,
  FormSelect,
  FormRadioGroup,
  FormDate,
  FormFileUpload,
  FormTextarea,
  FormActions,
} from "../components/forms/index.js";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
const TRAINING_TYPES = [
  { value: "WeightLoss", label: "Weight Loss" },
  { value: "WeightGain", label: "Weight Gain" },
  { value: "Transformation", label: "Transformation" },
];
const TRAINING_TYPE_MAP = { WeightLoss: "Weight Loss", WeightGain: "Weight Gain", Transformation: "Transformation" };
const packagePriceFor = (pkg, trainingType) => {
  if (!pkg) return null;
  return { WeightLoss: pkg.priceWeightLoss, WeightGain: pkg.priceWeightGain, Transformation: pkg.priceTransformation }[trainingType] ?? null;
};
const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "gpay", label: "UPI" },
  { value: "card", label: "Card" },
];

const SYSTEM_KEYS = [
  "fullName", "fatherName", "dob", "bloodGroup", "gender", "medicalIssues",
  "address", "aadhar", "occupation", "phone", "trainingType", "gymPlan",
];

const EMPTY_FORM = {
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
};

export default function AdminRegister() {
  const admin = useAdmin();
  const allowedGenders = allowedGendersForScope(admin?.scope);

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [dynamicFields, setDynamicFields] = useState([]);
  const [customFields, setCustomFields] = useState({});
  const [packages, setPackages] = useState([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [packagesError, setPackagesError] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("not_paid");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [includeDiet, setIncludeDiet] = useState(false);
  const [selectedDietId, setSelectedDietId] = useState(null);
  const [selectedDietName, setSelectedDietName] = useState(null);
  const [selectedDietDescription, setSelectedDietDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [registerSuccessMessage, setRegisterSuccessMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // Idempotency key: same key for retries of the same submission; a new key
  // after a successful registration.
  const [clientRequestId, setClientRequestId] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `cri-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const fetchedRef = useRef(false);
  const draftLoadedRef = useRef(false);
  const autosaveTimerRef = useRef(null);

  // Default gender from the authenticated admin's scope.
  useEffect(() => {
    setForm((prev) => ({ ...prev, gender: defaultGenderForScope(admin?.scope, prev.gender) }));
  }, [admin]);

  // Compute the selected price from package + training type.
  useEffect(() => {
    if (!form.gymPlan || !form.trainingType) {
      setForm((prev) => ({ ...prev, selectedPrice: 0 }));
      return;
    }
    const pkg = packages.find((item) => item._id === form.gymPlan);
    setForm((prev) => ({ ...prev, selectedPrice: packagePriceFor(pkg, form.trainingType) || 0 }));
  }, [form.gymPlan, form.trainingType, packages]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadPackages();
    loadDynamicFields();
    loadDraft();

    const handleVisibilityChange = () => {
      if (!document.hidden) loadDynamicFields();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const loadPackages = async () => {
    setPackagesLoading(true);
    setPackagesError(null);
    try {
      const res = await apiClient.get("/packages");
      setPackages(res.data?.data || res.data || []);
    } catch (err) {
      console.log("Failed loading packages:", err);
      setPackages([]);
      setPackagesError("Unable to load packages. Please try again.");
    } finally {
      setPackagesLoading(false);
    }
  };

  const loadDynamicFields = async () => {
    try {
      const res = await apiClient.get("/fields/member");
      setDynamicFields(res.data?.data || res.data || []);
    } catch (err) {
      console.log("Failed loading dynamic fields", err);
    }
  };

  // ── Draft persistence (per admin + session, server-side) ────────────────
  const loadDraft = async () => {
    try {
      const res = await apiClient.get("/members/register/draft");
      const draft = res.data?.data;
      if (draft && typeof draft === "object" && Object.keys(draft).length > 0) {
        setForm((prev) => ({ ...prev, ...(draft.form || {}) }));
        setCustomFields(draft.customFields || {});
        setPaymentStatus(draft.paymentStatus || "not_paid");
        setPaymentMode(draft.paymentMode || "cash");
        setIncludeDiet(!!draft.includeDiet);
        setSelectedDietId(draft.selectedDietId || null);
        setSelectedDietName(draft.selectedDietName || null);
        setSelectedDietDescription(draft.selectedDietDescription || "");
        // Photo cannot be restored from the server — the user re-selects it.
      }
    } catch (err) {
      console.log("No draft or failed to load draft:", err?.response?.status);
    } finally {
      draftLoadedRef.current = true;
    }
  };

  const saveDraft = () => {
    // Debounced autosave — never on every keystroke.
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      if (!draftLoadedRef.current) return; // avoid overwriting while loading
      try {
        await apiClient.put("/members/register/draft", {
          data: {
            form,
            customFields,
            paymentStatus,
            paymentMode,
            includeDiet,
            selectedDietId,
            selectedDietName,
            selectedDietDescription,
          },
        });
      } catch (err) {
        // Silent autosave failure — the user can still register manually.
        console.log("Draft autosave failed:", err?.response?.status);
      }
    }, 800);
  };

  const discardDraft = async () => {
    try {
      await apiClient.delete("/members/register/draft");
    } catch (err) {
      console.log("Discard draft failed:", err?.response?.status);
    }
    setForm({ ...EMPTY_FORM, gender: allowedGenders[0] || "Male" });
    setCustomFields({});
    setPhoto(null);
    setPhotoPreview("");
    setPaymentStatus("not_paid");
    setPaymentMode("cash");
    setIncludeDiet(false);
    setSelectedDietId(null);
    setSelectedDietName(null);
    setSelectedDietDescription("");
    setFieldErrors({});
    setSubmitError(null);
  };

  // Autosave on form changes (debounced).
  useEffect(() => {
    saveDraft();
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, customFields, paymentStatus, paymentMode, includeDiet, selectedDietId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
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
    if (form.aadhar.replace(/\D/g, "").length !== 12) errors.aadhar = "Aadhar must be 12 digits";
    if (!/^[6-9]\d{9}$/.test(form.phone)) errors.phone = "Phone must start with 6-9 and be 10 digits";
    if (paymentStatus === "paid" && !form.gymPlan) errors.gymPlan = "Gym plan is required for billing";

    for (const field of dynamicFields) {
      if (field.required && field.isEnabled && !SYSTEM_KEYS.includes(field.key) && !String(customFields[field.key] || "").trim()) {
        errors[field.key] = `${field.label} is required`;
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const openPreview = (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setSubmitError(null);
    setShowPreview(true);
  };

  const selectedPackage = packages.find((item) => item._id === form.gymPlan);
  const planLabel = selectedPackage ? (selectedPackage.months === 1 ? "1 Month" : `${selectedPackage.months} Months`) : "-";
  const finalGender = allowedGenders.includes(form.gender) ? form.gender : allowedGenders[0];

  const computeValidityLabel = () => {
    if (paymentStatus !== "paid" || !form.gymPlan) return "-";
    const d = new Date();
    d.setMonth(d.getMonth() + (selectedPackage?.months || 0));
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString("en-GB");
  };

  const submitRegistration = async () => {
    setSubmitError(null);
    setSubmitting(true);

    try {
      const fd = new FormData();
      if (!selectedPackage) {
        setSubmitError("Invalid package selected");
        setSubmitting(false);
        return;
      }

      fd.append("clientRequestId", clientRequestId);
      fd.append("fullName", form.fullName.trim());
      fd.append("fatherName", form.fatherName.trim());
      fd.append("dob", form.dob);
      fd.append("bloodGroup", form.bloodGroup);
      fd.append("gender", finalGender);
      fd.append("medicalIssues", form.medicalIssues.trim());
      fd.append("customFields", JSON.stringify(customFields));
      fd.append("address", form.address.trim());
      fd.append("aadhar", form.aadhar.replace(/\D/g, ""));
      fd.append("occupation", form.occupation.trim());
      fd.append("phone", form.phone);
      fd.append("gymPlan", planLabel);
      fd.append("trainingType", TRAINING_TYPE_MAP[form.trainingType]);
      fd.append("amount", String(form.selectedPrice));
      fd.append("paymentStatus", paymentStatus);
      if (paymentStatus === "paid") fd.append("paymentMode", paymentMode);
      if (photo) fd.append("photo", photo);

      if (includeDiet && selectedDietId) {
        fd.append("dietId", selectedDietId);
        fd.append("dietIncludedInLastBilling", "true");
      }

      const response = await apiClient.post("/members/register", fd);
      const newMember = response.data?.member || response.data?.data || response.data || {};

      let selectedDiet = null;
      if (includeDiet && selectedDietId) {
        try {
          const dietResponse = await apiClient.get(`/diets/${selectedDietId}`);
          selectedDiet = dietResponse.data?.data || dietResponse.data || null;
        } catch {
          selectedDiet = { _id: selectedDietId, name: selectedDietName, description: selectedDietDescription };
        }
      }

      // Success: clear the draft, show the member code, download the invoice.
      await apiClient.delete("/members/register/draft").catch(() => {});
      setRegisterSuccessMessage(`Member registered successfully! Member Code: ${newMember.memberCode || ""} | Gym ID: ${newMember.gymId || ""}`);

      downloadMembershipInvoice({
        member: {
          ...newMember,
          fullName: newMember.fullName || form.fullName,
          phone: newMember.phone || form.phone,
          gymPlan: planLabel,
          trainingType: newMember.trainingType || TRAINING_TYPE_MAP[form.trainingType],
          paymentMode,
        },
        mode: "registration",
        issuer: admin?.fullName || admin?.username || "Giri Gym Admin",
        planLabel,
        trainingType: newMember.trainingType || TRAINING_TYPE_MAP[form.trainingType],
        price: form.selectedPrice,
        validityLabel: newMember.validityEnd ? new Date(newMember.validityEnd).toLocaleDateString("en-GB") : "-",
        paymentMode: paymentStatus === "paid" ? paymentMode : "-",
        diet: selectedDiet,
      });

      // Reset the form but keep the scope default gender.
      setForm({ ...EMPTY_FORM, gender: allowedGenders[0] || "Male" });
      setPhoto(null);
      setPhotoPreview("");
      setShowPreview(false);
      setPaymentStatus("not_paid");
      setPaymentMode("cash");
      setCustomFields({});
      setIncludeDiet(false);
      setSelectedDietId(null);
      setSelectedDietName(null);
      setSelectedDietDescription("");
      setSubmitError(null);
      setFieldErrors({});
      setClientRequestId(typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `cri-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    } catch (err) {
      // IMPORTANT: do NOT reset the form on failure — preserve entered values.
      const errorMessage = err.response?.data?.message || err.message || "Registration Failed. Please try again.";
      console.error("Registration Error:", err);
      setSubmitError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const enabledCustomFields = dynamicFields.filter((f) => !SYSTEM_KEYS.includes(f.key) && f.isEnabled);
  const emergencyFields = enabledCustomFields.filter((f) => f.key.toLowerCase().includes("emergency"));
  const otherCustomFields = enabledCustomFields.filter((f) => !f.key.toLowerCase().includes("emergency"));

  return (
    <div className="saas-container">
      {registerSuccessMessage && (
        <div className="mt-4 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700 mb-4">
          {registerSuccessMessage}
        </div>
      )}
      {submitError && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 mb-4" role="alert">
          {submitError}
        </div>
      )}

      <form onSubmit={openPreview} noValidate className="register-form-shell" style={{ background: "var(--surface-soft)", padding: "20px 20px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)" }}>
        <div className="register-layout">
          <div className="register-layout-main">
        {/* ── 1. Personal Information ─────────────────────────────────── */}
        <FormSection title="Personal Information" subtitle="Identity and contact details">
          <div className="register-grid">
            <FormField label="Full Name" required error={fieldErrors.fullName}>
              <FormInput name="fullName" value={form.fullName} onChange={handleChange} placeholder="e.g. Ravi Kumar" error={fieldErrors.fullName} />
            </FormField>
            <FormField label="Father's Name" required error={fieldErrors.fatherName}>
              <FormInput name="fatherName" value={form.fatherName} onChange={handleChange} placeholder="e.g. Suresh Kumar" error={fieldErrors.fatherName} />
            </FormField>
            <FormField label="Date of Birth" required error={fieldErrors.dob}>
              <FormDate name="dob" value={form.dob} onChange={handleChange} error={fieldErrors.dob} />
            </FormField>
            <FormField label="Gender" required>
              <FormSelect name="gender" value={form.gender} onChange={handleChange}>
                {allowedGenders.map((g) => (<option key={g} value={g}>{g}</option>))}
              </FormSelect>
              {allowedGenders.length === 1 && <p className="register-field-hint">Your scope only allows {allowedGenders[0]} members.</p>}
            </FormField>
            <FormField label="Blood Group" required error={fieldErrors.bloodGroup}>
              <FormSelect name="bloodGroup" value={form.bloodGroup} onChange={handleChange} placeholder="Select blood group" error={fieldErrors.bloodGroup}>
                {BLOOD_GROUPS.map((bg) => (<option key={bg} value={bg}>{bg}</option>))}
              </FormSelect>
            </FormField>
            <FormField label="Occupation" required error={fieldErrors.occupation}>
              <FormInput name="occupation" value={form.occupation} onChange={handleChange} placeholder="e.g. Engineer" error={fieldErrors.occupation} />
            </FormField>
            <FormField label="Aadhaar Number" required error={fieldErrors.aadhar} hint="12-digit Aadhaar number">
              <FormInput name="aadhar" value={form.aadhar} onChange={(e) => setForm((prev) => ({ ...prev, aadhar: e.target.value.replace(/\D/g, "") }))} placeholder="0000 0000 0000" inputMode="numeric" maxLength={12} error={fieldErrors.aadhar} />
            </FormField>
            <FormField label="Phone" required error={fieldErrors.phone}>
              <FormInput name="phone" value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value.replace(/\D/g, "") }))} placeholder="10-digit mobile" inputMode="numeric" maxLength={10} error={fieldErrors.phone} />
            </FormField>
            <div className="register-span-full">
              <FormField label="Address" required error={fieldErrors.address}>
                <FormTextarea name="address" value={form.address} onChange={handleChange} placeholder="Full address" rows={3} error={fieldErrors.address} />
              </FormField>
            </div>
          </div>
        </FormSection>

        {/* ── 2. Membership ─────────────────────────────── */}
        <FormSection title="Membership" subtitle="Training goal, plan and add-ons">
          <div className="register-grid">
            <div className="register-span-full">
              <FormField label="Training Goal" required error={fieldErrors.trainingType}>
                <FormRadioGroup name="trainingType" value={form.trainingType} onChange={(v) => handleChange({ target: { name: "trainingType", value: v } })} options={TRAINING_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
              </FormField>
            </div>
            <div className="register-span-full">
              <FormField label="Membership Plan" required error={fieldErrors.gymPlan}>
                {packagesLoading ? (
                  <p className="register-field-hint">Loading packages…</p>
                ) : packagesError ? (
                  <p className="register-field-error" role="alert">{packagesError}</p>
                ) : packages.length === 0 ? (
                  <p className="register-field-hint">No packages available. Contact your administrator.</p>
                ) : (
                  <div className="register-package-grid">
                    {packages.map((pkg) => {
                      const selected = form.gymPlan === pkg._id;
                      const price = packagePriceFor(pkg, form.trainingType);
                      return (
                        <div
                          key={pkg._id}
                          role="radio"
                          aria-checked={selected}
                          tabIndex={0}
                          className={`register-package-card${selected ? " is-selected" : ""}`}
                          onClick={() => handleChange({ target: { name: "gymPlan", value: pkg._id } })}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleChange({ target: { name: "gymPlan", value: pkg._id } }); } }}
                        >
                          <span className="register-package-name">{pkg.name}</span>
                          <span className="register-package-duration">{pkg.months} {pkg.months === 1 ? "Month" : "Months"}</span>
                          <span className="register-package-price">{price != null ? `Rs. ${price}` : "—"}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </FormField>
            </div>
            <div className="register-span-full">
              <div className="register-addon">
                <input type="checkbox" checked={includeDiet} onChange={(e) => setIncludeDiet(e.target.checked)} className="accent-check" id="include-diet" />
                <div>
                  <label htmlFor="include-diet" className="register-addon-title">Include Diet Plan</label>
                  <p className="register-addon-desc">Personalized diet plan attached to the membership.</p>
                </div>
              </div>
            </div>
            {includeDiet && (
              <div className="register-span-full">
                <DietSelector
                  trainingType={form.trainingType}
                  onDietSelect={(dietId, dietName, dietDescription) => {
                    setSelectedDietId(dietId);
                    setSelectedDietName(dietName);
                    setSelectedDietDescription(dietDescription || "");
                  }}
                />
              </div>
            )}
          </div>
        </FormSection>

        {/* ── 3. Health & Emergency ────────────────────────────────── */}
        <FormSection title="Health & Emergency" subtitle="Health notes for the training team">
          <div className="register-grid">
            <div className="register-span-full">
              <FormField label="Medical Conditions / Injuries" hint="Existing injuries, allergies or conditions">
                <FormTextarea name="medicalIssues" value={form.medicalIssues} onChange={handleChange} placeholder="e.g. Knee injury, asthma (optional)" rows={3} />
              </FormField>
            </div>
            {emergencyFields.length > 0 && emergencyFields.map((field) => (
              <FormField key={field._id} label={field.label} required={field.required} error={fieldErrors[field.key]}>
                {field.type === "dropdown" ? (
                  <FormSelect
                    name={field.key}
                    value={customFields[field.key] || ""}
                    onChange={(e) => { handleCustomFieldChange(field.key, e.target.value); if (fieldErrors[field.key]) setFieldErrors((prev) => ({ ...prev, [field.key]: undefined })); }}
                    placeholder="Select"
                    error={fieldErrors[field.key]}
                  >
                    {(field.options || []).map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                  </FormSelect>
                ) : (
                  <FormInput
                    type={field.type || "text"}
                    name={field.key}
                    value={customFields[field.key] || ""}
                    onChange={(e) => { handleCustomFieldChange(field.key, e.target.value); if (fieldErrors[field.key]) setFieldErrors((prev) => ({ ...prev, [field.key]: undefined })); }}
                    error={fieldErrors[field.key]}
                  />
                )}
              </FormField>
            ))}
          </div>
        </FormSection>

        {/* ── 5. Additional Information ────────── */}
        {otherCustomFields.length > 0 && (
          <FormSection title="Additional Information" subtitle="Additional details for this member">
            <div className="register-grid">
              {otherCustomFields.map((field) => (
                <FormField key={field._id} label={field.label} required={field.required} error={fieldErrors[field.key]}>
                  {field.type === "dropdown" ? (
                    <FormSelect
                      name={field.key}
                      value={customFields[field.key] || ""}
                      onChange={(e) => { handleCustomFieldChange(field.key, e.target.value); if (fieldErrors[field.key]) setFieldErrors((prev) => ({ ...prev, [field.key]: undefined })); }}
                      placeholder="Select"
                      error={fieldErrors[field.key]}
                    >
                      {(field.options || []).map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                    </FormSelect>
                  ) : (
                    <FormInput
                      type={field.type || "text"}
                      name={field.key}
                      value={customFields[field.key] || ""}
                      onChange={(e) => { handleCustomFieldChange(field.key, e.target.value); if (fieldErrors[field.key]) setFieldErrors((prev) => ({ ...prev, [field.key]: undefined })); }}
                      error={fieldErrors[field.key]}
                    />
                  )}
                </FormField>
              ))}
            </div>
          </FormSection>
        )}

        {/* ── 5. Payment ────────────────────────────────── */}
        <FormSection title="Payment" subtitle="Status and method">
          <div className="register-grid">
            <FormField label="Payment Status" required>
              <FormRadioGroup name="paymentStatus" value={paymentStatus} onChange={setPaymentStatus} options={[{ value: "paid", label: "Paid" }, { value: "not_paid", label: "Not Paid" }]} />
            </FormField>
            {paymentStatus === "paid" && (
              <FormField label="Payment Mode" required>
                <FormRadioGroup name="paymentMode" value={paymentMode} onChange={setPaymentMode} options={PAYMENT_MODES} />
              </FormField>
            )}
            {form.selectedPrice > 0 && (
              <div className="register-span-full">
                <div className="register-amount">
                  <span className="register-amount-label">Amount</span>
                  <span className="register-amount-value">Rs. {form.selectedPrice}</span>
                </div>
              </div>
            )}
          </div>
        </FormSection>

        <FormActions
          label="Register Member"
          onPrimary={openPreview}
          onDiscard={discardDraft}
          submitting={submitting}
          disabled={submitting}
        />
          </div>

          <div className="register-photo-side">
            <FormField label="Profile Photo" hint="Optional photo used on the membership card">
              <FormFileUpload onFile={(file) => { setPhoto(file); setPhotoPreview(URL.createObjectURL(file)); }} preview={photoPreview} />
            </FormField>
          </div>
        </div>
      </form>

      {/* ── Final preview modal ─────────────────────────────────────── */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] p-4" onClick={() => !submitting && setShowPreview(false)}>
          <div className="w-full max-w-lg rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-6 shadow-2xl border border-[var(--border-strong)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-xl font-semibold">Review member details</h3>
            <div style={{ maxHeight: "55vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px" }}>
              <PreviewGroup title="Personal Information" rows={[
                ["Full Name", form.fullName],
                ["Father's Name", form.fatherName],
                ["Date of Birth", form.dob],
                ["Gender", finalGender],
                ["Blood Group", form.bloodGroup],
                ["Phone", form.phone],
                ["Aadhaar", form.aadhar.replace(/\D/g, "")],
                ["Occupation", form.occupation],
                ["Address", form.address],
              ]} />
              <PreviewGroup title="Membership & Billing" rows={[
                ["Training Goal", TRAINING_TYPE_MAP[form.trainingType]],
                ["Package", planLabel],
                ["Amount", `Rs. ${form.selectedPrice}`],
                ["Payment Status", paymentStatus === "paid" ? "Paid" : "Not Paid"],
                ["Payment Mode", paymentStatus === "paid" ? paymentMode : "-"],
                ["Valid Until", computeValidityLabel()],
                ["Diet Plan", includeDiet && selectedDietName ? selectedDietName : "—"],
              ]} />
              <PreviewGroup title="Medical & Additional" rows={[
                ["Medical Issues", form.medicalIssues || "—"],
                ...otherCustomFields.map((f) => [f.label, customFields[f.key] || "—"]),
              ]} />
              {photoPreview && <PreviewGroup title="Photo" rows={[["", "Uploaded ✓"]]} />}
            </div>

            {submitError && (
              <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700" role="alert">{submitError}</div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowPreview(false)} disabled={submitting} className="btn-secondary" style={{ minHeight: 0, padding: "10px 18px" }}>
                Cancel
              </button>
              <button type="button" onClick={submitRegistration} disabled={submitting} className="btn-primary" style={{ minHeight: 0, padding: "10px 22px" }}>
                {submitting ? "Registering…" : "Confirm Registration"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewGroup({ title, rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div>
      <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>{title}</p>
      <div style={{ border: "1px solid var(--border-color)", borderRadius: "10px", overflow: "hidden" }}>
        {rows.map(([k, v], i) => (
          <div key={i} style={{ display: "flex", gap: "12px", padding: "8px 12px", background: i % 2 === 0 ? "var(--surface-muted)" : "transparent" }}>
            <span style={{ flex: "0 0 40%", fontSize: "13px", color: "var(--text-secondary)" }}>{k}</span>
            <span style={{ flex: 1, fontSize: "13px", fontWeight: 500, color: "var(--text-primary)", wordBreak: "break-word" }}>{v || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
