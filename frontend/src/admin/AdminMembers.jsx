import { useEffect, useRef, useState } from "react";
import { DietSelector } from "../components/DietSelector";
import apiClient from "../utils/apiClient.js";
import { downloadMembershipInvoice } from "../utils/invoicePdf.js";
import { getDaysRemaining, getDaysIndicatorClass } from "../utils/memberStatus.js";

const MS_DAY = 1000 * 60 * 60 * 24;

export default function AdminMembers() {
  const [members, setMembers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [showDeletePopup, setShowDeletePopup] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [showRenewPopup, setShowRenewPopup] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [renewMode, setRenewMode] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);
  const [renewSubmitting, setRenewSubmitting] = useState(false);
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [renewError, setRenewError] = useState(null);
  const [renewLoading, setRenewLoading] = useState(false);
  const [renewSubmitError, setRenewSubmitError] = useState(null);
  const [renewData, setRenewData] = useState({
    packageId: "",
    trainingType: "",
    price: 0,
    extraDays: 0,
    paymentStatus: "paid",
    paymentMode: "cash",
    previewNewValidity: "-",
    lateDays: 0,
    deductLate: false,
    includeDiet: false,
    dietId: null,
    dietName: null,
    dietDescription: "",
  });
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadMembers();
    loadPackages();
    loadCurrentAdmin();
  }, []);

  const loadMembers = async () => {
    try {
      const res = await apiClient.get("/members");
      setMembers(res.data?.data || res.data || []);
    } catch (err) {
      console.log("Error loading members:", err);
    }
  };

  const loadPackages = async () => {
    try {
      const res = await apiClient.get("/packages");
      setPackages(res.data?.data || res.data || []);
    } catch (err) {
      console.log("Error loading packages:", err);
    }
  };

  const loadCurrentAdmin = async () => {
    try {
      const res = await apiClient.get("/admin/me");
      setCurrentAdmin(res.data?.admin || res.data?.data || res.data || null);
    } catch (err) {
      console.log("Error loading current admin:", err);
    }
  };

  const formatDate = (date) => {
    if (!date || date === "-") return "-";
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString("en-GB");
  };

  const diffDays = (start, end) => Math.ceil((end - start) / MS_DAY);

  const addMonths = (date, months) => {
    const copy = new Date(date);
    copy.setMonth(copy.getMonth() + months);
    return copy;
  };

  const getPlanLabel = (months) => (months === 1 ? "1 Month" : `${months} Months`);

  const getPlanMonthsFromLabel = (plan) =>
    ({
      "1 Month": 1,
      "3 Months": 3,
      "6 Months": 6,
      "1 Year": 12,
      "12 Months": 12,
    }[plan] || 0);

  const getPackagePrice = (pkg, trainingType) => {
    if (!pkg) return 0;
    switch (trainingType) {
      case "Weight Loss":
        return pkg.priceWeightLoss;
      case "Weight Gain":
        return pkg.priceWeightGain;
      case "Transformation":
        return pkg.priceTransformation;
      default:
        return 0;
    }
  };

  const getCurrentPackageForMember = (member) => {
    const months = getPlanMonthsFromLabel(member.gymPlan);
    return packages.find((item) => Number(item.months) === months) || null;
  };

  const closeRenewModal = () => {
    setShowRenewPopup(false);
    setSelectedMember(null);
    setRenewMode(false);
    setRenewSubmitting(false);
    setRenewSubmitError(null);
  };

  const handleModeToggle = (enabled) => {
    if (!selectedMember) {
      setRenewMode(enabled);
      return;
    }

    if (!enabled) {
      const currentPackage = getCurrentPackageForMember(selectedMember);
      const currentTrainingType = selectedMember.trainingType || "";
      const currentPrice = getPackagePrice(currentPackage, currentTrainingType);

      setRenewData((prev) => ({
        ...prev,
        packageId: currentPackage?._id || "",
        trainingType: currentTrainingType,
        price: currentPrice,
        extraDays: 0,
        paymentStatus: "paid",
        paymentMode: selectedMember.paymentMode || "cash",
        previewNewValidity: formatDate(selectedMember.validityEnd),
        deductLate: false,
      }));
    }

    setRenewMode(enabled);
  };

  const confirmDelete = (gymId) => {
    setDeleteId(gymId);
    setShowDeletePopup(true);
  };

  const deleteMember = async () => {
    try {
      await apiClient.delete(`/members/${deleteId}`);
      setMembers((prev) => prev.filter((member) => member.gymId !== deleteId));
      setShowDeletePopup(false);
      alert("Member deleted successfully");
    } catch (err) {
      alert("Delete failed");
      console.log(err);
    }
  };

  const openRenew = async (gymId) => {
    setRenewError(null);
    setRenewLoading(true);
    try {
      const res = await apiClient.get(`/members/${gymId}`);
      const member = res.data?.data || res.data;
      
      if (!member || !member._id) {
        throw new Error("Member data not found");
      }
      
      const today = new Date();
      const validityEnd = member.validityEnd ? new Date(member.validityEnd) : null;
      const lateDays = validityEnd && today > validityEnd ? diffDays(validityEnd, today) : 0;
      const currentPackage = getCurrentPackageForMember(member);
      const trainingType = member.trainingType || "";
      const price = getPackagePrice(currentPackage, trainingType);

      setSelectedMember(member);
      setRenewMode(false);
      setRenewData({
        packageId: currentPackage?._id || "",
        trainingType,
        price,
        extraDays: 0,
        paymentStatus: "paid",
        paymentMode: member.paymentMode || "cash",
        previewNewValidity: formatDate(member.validityEnd),
        lateDays,
        deductLate: false,
        includeDiet: Boolean(member.dietId || member.dietIncludedInLastBilling),
        dietId: member.dietId || null,
        dietName: member.dietName || null,
        dietDescription: "",
      });
      setShowRenewPopup(true);
    } catch (err) {
      console.error("Failed to load member details:", err);
      const errorMsg = err.response?.data?.message || err.message || "Failed to load member details";
      setRenewError(errorMsg);
      setSelectedMember(null);
      setShowRenewPopup(false);
    } finally {
      setRenewLoading(false);
    }
  };

  useEffect(() => {
    if (!showRenewPopup || !selectedMember) return;

    if (!renewMode) {
      setRenewData((prev) => ({
        ...prev,
        previewNewValidity: formatDate(selectedMember.validityEnd),
      }));
      return;
    }

    const pkg = packages.find((item) => item._id === renewData.packageId);
    if (!pkg) {
      setRenewData((prev) => ({
        ...prev,
        previewNewValidity: formatDate(selectedMember.validityEnd),
      }));
      return;
    }

    const today = new Date();
    const oldEnd = selectedMember.validityEnd ? new Date(selectedMember.validityEnd) : null;
    const base = oldEnd || today;
    let newDate = addMonths(base, pkg.months);
    newDate.setDate(newDate.getDate() - 1);

    let delta = Number(renewData.extraDays) || 0;
    if (renewData.deductLate && renewData.lateDays > 0) {
      delta -= renewData.lateDays;
    }
    if (delta !== 0) {
      newDate.setDate(newDate.getDate() + delta);
    }

    setRenewData((prev) => ({
      ...prev,
      previewNewValidity: formatDate(newDate),
    }));
  }, [
    renewData.packageId,
    renewData.extraDays,
    renewData.deductLate,
    showRenewPopup,
    selectedMember,
    packages,
    renewMode,
  ]);

  const downloadCurrentBill = () => {
    if (!selectedMember) return;

    downloadMembershipInvoice({
      member: selectedMember,
      mode: "bill",
      issuer: currentAdmin?.fullName || currentAdmin?.username || "Giri Gym Admin",
      planLabel: selectedMember.gymPlan,
      trainingType: renewData.trainingType || selectedMember.trainingType,
      price: renewData.price,
      validityLabel: formatDate(selectedMember.validityEnd),
      paymentMode: renewData.paymentMode || selectedMember.paymentMode,
      diet:
        renewData.includeDiet && renewData.dietId
          ? {
              _id: renewData.dietId,
              name: renewData.dietName,
              description: renewData.dietDescription,
            }
          : null,
    });

    closeRenewModal();
  };

  const submitRenewal = async () => {
    setRenewSubmitError(null);
    
    if (!selectedMember || !renewMode) return;
    if (renewData.paymentStatus === "not_paid") {
      alert("Marked as not paid. Renewal skipped.");
      closeRenewModal();
      return;
    }

    if (!renewData.packageId) {
      setRenewSubmitError("Please select a package");
      return;
    }
    if (!renewData.trainingType) {
      setRenewSubmitError("Please select training type");
      return;
    }

    const pkg = packages.find((item) => item._id === renewData.packageId);
    if (!pkg) {
      setRenewSubmitError("Invalid package selected");
      return;
    }

    const body = {
      newPlan: getPlanLabel(pkg.months),
      trainingType: renewData.trainingType,
      extraDays: renewData.extraDays,
      paymentMode: renewData.paymentMode,
      price: renewData.price,
    };

    if (renewData.includeDiet && renewData.dietId) {
      body.dietId = renewData.dietId;
      body.dietIncludedInLastBilling = "true";
    }

    try {
      setRenewSubmitting(true);
      await apiClient.put(`/members/renew/${selectedMember.gymId}`, body);
      const refreshed = await apiClient.get(`/members/${selectedMember.gymId}`);
      const renewedMember = refreshed.data?.data || refreshed.data;

      downloadMembershipInvoice({
        member: renewedMember,
        mode: "renew",
        issuer: currentAdmin?.fullName || currentAdmin?.username || "Giri Gym Admin",
        planLabel: body.newPlan,
        trainingType: renewData.trainingType,
        price: renewData.price,
        validityLabel: renewData.previewNewValidity,
        paymentMode: renewData.paymentMode,
        diet:
          renewData.includeDiet && renewData.dietId
            ? {
                _id: renewData.dietId,
                name: renewData.dietName,
                description: renewData.dietDescription,
              }
            : null,
      });

      await loadMembers();
      closeRenewModal();
      alert("Membership renewed successfully");
    } catch (err) {
      console.error("Renewal failed:", err);
      const errorMsg = err.response?.data?.message || err.message || "Renewal failed. Please try again.";
      setRenewSubmitError(errorMsg);
    } finally {
      setRenewSubmitting(false);
    }
  };

  const filteredMembers = members.filter((member) => {
    if (filterStatus === "paid") return member.paymentStatus === "paid";
    if (filterStatus === "not_paid") return member.paymentStatus === "not_paid";
    return true;
  });

  const sortedMembers = [...filteredMembers]
    .map((member) => ({
      ...member,
      daysLeft: getDaysRemaining(member.validTill || member.validityEnd),
    }))
    .sort((a, b) => (sortAsc ? a.daysLeft - b.daysLeft : b.daysLeft - a.daysLeft));

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="section-heading">
          <span className="eyebrow">Members</span>
          <h2 className="text-3xl">Member management</h2>
          <p className="panel-subtitle">Review members, sort by urgency, renew plans, and remove records when needed.</p>
        </div>
        {renewError && (
          <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {renewError}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="field-group sm:max-w-xs">
            <label className="field-label">Payment Status</label>
            <select className="field-control" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">All Members</option>
              <option value="paid">Paid</option>
              <option value="not_paid">Not Paid</option>
            </select>
          </div>

          <button onClick={() => setSortAsc((prev) => !prev)} className="btn-secondary sm:mt-7">
            Sort Days Left {sortAsc ? "Ascending" : "Descending"}
          </button>
        </div>
      </section>

      <section className="table-shell">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Gym ID</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Valid Till</th>
                <th>Days Left</th>
                <th>Plan</th>
                <th>Payment</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedMembers.map((member) => (
                <tr key={member.gymId}>
                  <td>{member.gymId}</td>
                  <td>{member.name || member.fullName}</td>
                  <td>{member.phone}</td>
                  <td>{formatDate(member.validTill || member.validityEnd)}</td>
                  <td>
                    <span className={getDaysIndicatorClass(member.daysLeft)}>
                      {member.daysLeft}
                    </span>
                  </td>
                  <td>{member.plan || member.gymPlan}</td>
                  <td>{member.paymentStatus}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button 
                        onClick={() => openRenew(member.gymId)} 
                        className="btn-primary min-h-0 px-4 py-2"
                        disabled={renewLoading}
                      >
                        {renewLoading ? "Loading..." : "Renew"}
                      </button>
                      <button onClick={() => confirmDelete(member.gymId)} className="btn-danger min-h-0 px-4 py-2">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {sortedMembers.length === 0 && (
                <tr>
                  <td colSpan="8">
                    <div className="empty-state">No members found.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showDeletePopup && (
        <div className="modal-shell">
          <div className="modal-card">
            <div className="section-heading">
              <span className="eyebrow">Confirm Delete</span>
              <h3 className="panel-title">Remove member record?</h3>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={deleteMember} className="btn-danger">
                Yes
              </button>
              <button onClick={() => setShowDeletePopup(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showRenewPopup && selectedMember && (
        <div className="modal-shell">
          <div className="modal-card" style={{ width: "min(100%, 860px)" }}>
            <div className="flex flex-col gap-4 border-b border-[var(--border-color)] pb-5 md:flex-row md:items-start md:justify-between">
              <div className="section-heading">
                <span className="eyebrow">Membership Billing</span>
                <h3 className="panel-title">{selectedMember.fullName}</h3>
                <p className="panel-subtitle">Gym ID {selectedMember.gymId}</p>
              </div>

              <label className="checkbox-row rounded-xl border border-[var(--border-color)] px-4 py-3">
                <input
                  type="checkbox"
                  checked={renewMode}
                  onChange={(e) => handleModeToggle(e.target.checked)}
                  className="accent-check"
                />
                <span>{renewMode ? "Renew Mode" : "Bill Mode"}</span>
              </label>
            </div>

            <div className="modal-body form-grid-2 mt-6 custom-scrollbar">
              <div className="panel" style={{ padding: "20px", background: "var(--surface-muted)" }}>
                <div className="section-stack" style={{ gap: "8px" }}>
                  <p className="muted-copy">Phone: {selectedMember.phone}</p>
                  <p className="muted-copy">Registration Date: {formatDate(selectedMember.joiningDate || selectedMember.createdAt)}</p>
                  <p className="muted-copy">Current Validity: {formatDate(selectedMember.validityEnd)}</p>
                  <p className="muted-copy">Current Plan: {selectedMember.gymPlan || "-"}</p>
                  <p className="muted-copy">Training Type: {selectedMember.trainingType || "-"}</p>
                  <p className="muted-copy">Issued By: {currentAdmin?.fullName || currentAdmin?.username || "Admin"}</p>
                </div>
              </div>

              <div className="section-stack">
                <Field label="Package">
                  <select
                    className="field-control"
                    value={renewData.packageId}
                    onChange={(e) => {
                      const pkg = packages.find((item) => item._id === e.target.value);
                      setRenewData((prev) => ({
                        ...prev,
                        packageId: e.target.value,
                        price: getPackagePrice(pkg, prev.trainingType),
                      }));
                    }}
                    disabled={!renewMode}
                  >
                    <option value="">Select Package</option>
                    {packages.map((pkg) => (
                      <option key={pkg._id} value={pkg._id}>
                        {pkg.name} - {pkg.months} {pkg.months === 1 ? "Month" : "Months"}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Training Type">
                  <select
                    className="field-control"
                    value={renewData.trainingType}
                    onChange={(e) => {
                      const pkg = packages.find((item) => item._id === renewData.packageId);
                      setRenewData((prev) => ({
                        ...prev,
                        trainingType: e.target.value,
                        price: getPackagePrice(pkg, e.target.value),
                      }));
                    }}
                    disabled={!renewMode}
                  >
                    <option value="">Select Training Type</option>
                    <option value="Weight Loss">Weight Loss</option>
                    <option value="Weight Gain">Weight Gain</option>
                    <option value="Transformation">Transformation</option>
                  </select>
                </Field>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={renewData.includeDiet}
                    onChange={(e) =>
                      setRenewData((prev) => ({
                        ...prev,
                        includeDiet: e.target.checked,
                        dietId: e.target.checked ? prev.dietId : null,
                        dietName: e.target.checked ? prev.dietName : null,
                        dietDescription: e.target.checked ? prev.dietDescription : "",
                      }))
                    }
                    className="accent-check"
                  />
                  <span>Include Diet Plan</span>
                </label>

                {renewData.includeDiet && (
                  <DietSelector
                    key={`${selectedMember.gymId}-${renewMode}-${renewData.trainingType || selectedMember.trainingType || "default"}`}
                    trainingType={renewData.trainingType || selectedMember.trainingType}
                    initialDietId={renewData.dietId}
                    onDietSelect={(dietId, dietName, dietDescription) =>
                      setRenewData((prev) => ({ ...prev, dietId, dietName, dietDescription: dietDescription || "" }))
                    }
                  />
                )}

                {renewMode && (
                  <>
                    <Field label="Extra Days">
                      <input
                        type="number"
                        className="field-control"
                        value={renewData.extraDays}
                        onChange={(e) => setRenewData((prev) => ({ ...prev, extraDays: Number(e.target.value) || 0 }))}
                      />
                    </Field>

                    <Field label="Paid Status">
                      <div className="radio-row">
                        <label className="radio-row">
                          <input
                            type="radio"
                            checked={renewData.paymentStatus === "paid"}
                            onChange={() => setRenewData((prev) => ({ ...prev, paymentStatus: "paid" }))}
                            className="accent-check"
                          />
                          Paid
                        </label>
                        <label className="radio-row">
                          <input
                            type="radio"
                            checked={renewData.paymentStatus === "not_paid"}
                            onChange={() => setRenewData((prev) => ({ ...prev, paymentStatus: "not_paid" }))}
                            className="accent-check"
                          />
                          Not Paid
                        </label>
                      </div>
                    </Field>

                    {renewData.paymentStatus === "paid" && (
                      <Field label="Payment Mode">
                        <select
                          className="field-control"
                          value={renewData.paymentMode}
                          onChange={(e) => setRenewData((prev) => ({ ...prev, paymentMode: e.target.value }))}
                        >
                          <option value="cash">Cash</option>
                          <option value="gpay">GPay</option>
                          <option value="card">Card</option>
                        </select>
                      </Field>
                    )}

                    {renewData.lateDays > 0 && (
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={renewData.deductLate}
                          onChange={() => setRenewData((prev) => ({ ...prev, deductLate: !prev.deductLate }))}
                          className="accent-check"
                        />
                        <span>Deduct {renewData.lateDays} late days</span>
                      </label>
                    )}
                  </>
                )}
              </div>
            </div>

            {renewSubmitError && (
              <div style={{
                padding: "12px",
                backgroundColor: "#fee",
                borderLeft: "4px solid #c33",
                borderRadius: "4px",
                color: "#c33",
                fontSize: "14px",
                margin: "16px 0"
              }}>
                {renewSubmitError}
              </div>
            )}

            <div className="modal-footer mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-color)] pt-5">
              <div className="section-stack" style={{ gap: "6px" }}>
                <p className="muted-copy">Mode: {renewMode ? "Renew" : "Bill"}</p>
                <p className="muted-copy">Validity: {renewData.previewNewValidity}</p>
                <p className="muted-copy">Price: Rs. {Number(renewData.price || 0).toFixed(2)}</p>
              </div>

              <div className="flex gap-3">
                <button onClick={closeRenewModal} className="btn-secondary">
                  Cancel
                </button>
                {!renewMode ? (
                  <button onClick={downloadCurrentBill} className="btn-primary">
                    Bill
                  </button>
                ) : (
                  <button onClick={submitRenewal} disabled={renewSubmitting} className="btn-primary">
                    {renewSubmitting ? "Processing..." : "Confirm"}
                  </button>
                )}
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
