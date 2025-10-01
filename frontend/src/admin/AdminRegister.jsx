import { useEffect, useRef, useState } from "react";
import { DietSelector } from "../components/DietSelector";
import apiClient from "../utils/apiClient.js";
import { downloadMembershipInvoice } from "../utils/invoicePdf.js";

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
      setCurrentAdmin(res.data?.admin || res.data?.data || res.data || null);
    } catch (err) {
      console.log("Failed loading admin", err);
    }
  };

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
    if (!form.fullName.trim()) return "Full Name required";
    if (!form.fatherName.trim()) return "Father Name required";
    if (!form.occupation.trim()) return "Occupation required";
    if (!form.address.trim()) return "Address required";
    if (!form.trainingType) return "Training type required";
    if (!form.dob) return "DOB required";
    if (!form.bloodGroup) return "Blood group required";
    if (!form.gymPlan) return "Gym plan required";

    const pkgExists = packages.find((item) => item._id === form.gymPlan);
    if (!pkgExists) return "Invalid package selected";
    if (form.aadhar.replace(/\D/g, "").length !== 12) return "Aadhar must be 12 digits";
    if (!/^[6-9]\d{9}$/.test(form.phone)) return "Phone must start with 6-9 and be 10 digits";

    for (const field of dynamicFields) {
      if (field.required && field.isEnabled && !SYSTEM_KEYS.includes(field.key) && !customFields[field.key]) {
        return `${field.label} is required`;
      }
    }

    return null;
  };

  const openPopup = (e) => {
    e.preventDefault();
    const err = validateForm();
    if (err) return alert(err);
    setShowPopup(true);
  };

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const submitRegistration = async () => {
    try {
      const fd = new FormData();
      const trainingTypeMap = {
        WeightLoss: "Weight Loss",
        WeightGain: "Weight Gain",
        Transformation: "Transformation",
      };

      const selectedPackage = packages.find((item) => item._id === form.gymPlan);
      if (!selectedPackage) return alert("Invalid package selected");
      const planLabel = selectedPackage.months === 1 ? "1 Month" : `${selectedPackage.months} Months`;

      fd.append("fullName", form.fullName);
      fd.append("fatherName", form.fatherName);
      fd.append("dob", form.dob);
      fd.append("bloodGroup", form.bloodGroup);
      fd.append("gender", form.gender);
      fd.append("medicalIssues", form.medicalIssues);
      fd.append("customFields", JSON.stringify(customFields));
      fd.append("address", form.address);
      fd.append("aadhar", form.aadhar.replace(/\D/g, ""));
      fd.append("occupation", form.occupation);
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

      const response = await apiClient.post("/members/register", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

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

      alert("Member Registered Successfully");

      setForm({
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
    } catch (err) {
      console.log("Registration Error:", err);
      alert(err.response?.data?.message || "Registration Failed");
    }
  };

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="section-heading">
          <span className="eyebrow">Member Intake</span>
          <h2 className="text-3xl">Register new member</h2>
          <p className="panel-subtitle">Create a complete member profile, choose a package, and confirm billing.</p>
        </div>
      </section>

      <form onSubmit={openPopup} className="panel">
        <div className="form-grid-3">
          <div className="grid gap-6 md:grid-cols-2 lg:col-span-2">
            <Field label="Full Name">
              <input name="fullName" value={form.fullName} onChange={handleChange} className="field-control" />
            </Field>
            <Field label="Father's Name">
              <input name="fatherName" value={form.fatherName} onChange={handleChange} className="field-control" />
            </Field>
            <Field label="Date of Birth">
              <input type="date" name="dob" value={form.dob} onChange={handleChange} className="field-control" />
            </Field>
            <Field label="Blood Group">
              <select name="bloodGroup" value={form.bloodGroup} onChange={handleChange} className="field-control">
                <option value="">Select</option>
                {["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((bg) => (
                  <option key={bg}>{bg}</option>
                ))}
              </select>
            </Field>
            <Field label="Occupation">
              <input name="occupation" value={form.occupation} onChange={handleChange} className="field-control" />
            </Field>
            <Field label="Aadhar">
              <input
                value={form.aadhar}
                maxLength="12"
                onChange={(e) => setForm({ ...form, aadhar: e.target.value.replace(/\D/g, "") })}
                className="field-control"
              />
            </Field>
            <Field label="Phone">
              <input
                value={form.phone}
                maxLength="10"
                onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })}
                className="field-control"
              />
            </Field>
            <Field label="Training Type">
              <select name="trainingType" value={form.trainingType} onChange={handleChange} className="field-control">
                <option value="">Select</option>
                <option value="WeightLoss">Weight Loss</option>
                <option value="WeightGain">Weight Gain</option>
                <option value="Transformation">Transformation</option>
              </select>
            </Field>
            <Field label="Gym Plan">
              <select name="gymPlan" value={form.gymPlan} onChange={handleChange} className="field-control">
                <option value="">Select Package</option>
                {packages.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name} - {item.months} Months
                  </option>
                ))}
              </select>
            </Field>

            {dynamicFields
              .filter((field) => !SYSTEM_KEYS.includes(field.key) && field.isEnabled)
              .map((field) => (
                <Field key={field._id} label={`${field.label}${field.required ? " *" : ""}`}>
                  {field.type === "dropdown" ? (
                    <select
                      value={customFields[field.key] || ""}
                      onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                      required={field.required}
                      className="field-control"
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
                      onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                      required={field.required}
                      className="field-control"
                    />
                  )}
                </Field>
              ))}

            <div className="md:col-span-2">
              <Field label="Address">
                <textarea name="address" value={form.address} onChange={handleChange} className="field-control" />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Medical Issues">
                <textarea name="medicalIssues" value={form.medicalIssues} onChange={handleChange} className="field-control" />
              </Field>
            </div>
          </div>

          <div className="section-stack">
            <Field label="Upload Photo">
              <input type="file" accept="image/*" onChange={handlePhoto} className="field-control" />
            </Field>
            {photoPreview && (
              <div className="image-preview">
                <img src={photoPreview} alt="Member preview" className="h-full w-full" />
              </div>
            )}

            {form.selectedPrice > 0 && (
              <div className="metric-card">
                <span className="eyebrow">Selected Price</span>
                <div className="metric-value text-success">Rs. {form.selectedPrice}</div>
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

        <button className="btn-primary mt-6 w-full">Register</button>
      </form>

      {showPopup && (
        <div className="modal-shell">
          <div className="modal-card">
            <div className="section-heading">
              <span className="eyebrow">Payment Confirmation</span>
              <h3 className="panel-title">Confirm billing</h3>
              <p className="panel-subtitle">Amount: Rs. {form.selectedPrice}</p>
            </div>

            <div className="section-stack mt-6">
              <div className="radio-row">
                <label className="radio-row">
                  <input type="radio" checked={paymentStatus === "paid"} onChange={() => setPaymentStatus("paid")} className="accent-check" />
                  Paid
                </label>
                <label className="radio-row">
                  <input
                    type="radio"
                    checked={paymentStatus === "not_paid"}
                    onChange={() => setPaymentStatus("not_paid")}
                    className="accent-check"
                  />
                  Not Paid
                </label>
              </div>

              {paymentStatus === "paid" && (
                <Field label="Payment Mode">
                  <select className="field-control" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="gpay">GPay</option>
                    <option value="card">Card</option>
                  </select>
                </Field>
              )}

              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn-primary" onClick={submitRegistration}>
                  Confirm and Submit
                </button>
                <button type="button" className="btn-secondary" onClick={() => setShowPopup(false)}>
                  Cancel
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
