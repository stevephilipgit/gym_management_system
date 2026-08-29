import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiUserPlus } from "react-icons/fi";
import { DietSelector } from "./components/DietSelector";
import apiClient from "../utils/apiClient.js";
import { downloadMembershipInvoice } from "./utils/invoicePdf.js";
import { getDaysRemaining, getDaysIndicatorClass } from "../utils/memberStatus.js";
import IconButton from "./components/ui/IconButton";
import RegisterForm from "./components/forms/RegisterForm";
import ToggleSwitch from "./components/ui/ToggleSwitch";
import MemberImportModal from "./components/MemberImportModal";
import { useAdmin, canAccess } from "./authContext.js";

const MS_DAY = 1000 * 60 * 60 * 24;

// Module-level member-list cache so navigating away from and back to the
// All Members page shows previously-loaded data immediately instead of
// flashing a loading/empty state. Keyed by (scope + page + filters + sort) so
// two admins with different scopes never share cached results.
const memberListCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60s — long enough for quick navigation, short enough to stay fresh

// In-session memory of the admin's All Members filter (keyed by admin id).
// Server-side Admin.preferences is the source of truth across logins/devices;
// this map only prevents the component from resetting to a stale context value
// when the admin navigates away and back within the same session.
const membersFilterMemory = new Map();

// Human-friendly display reference for the member list: M-1006 / F-1006 / T-1006.
// Display-only — the numeric gymId remains the authoritative identifier.
const GENDER_REF = { Male: "M", Female: "F", Transgender: "T" };
const memberRefFor = (member) => {
  const prefix = GENDER_REF[member.gender] || "M";
  return `${prefix}-${member.gymId}`;
};

export default function AdminMembers() {
  const admin = useAdmin();
  const isSuperadmin = canAccess(admin?.role, ["superadmin"]);
  const navigate = useNavigate();
  const adminId = admin?._id || admin?.id;
  const rememberedFilter = adminId ? membersFilterMemory.get(adminId) : null;
  const savedFilter = rememberedFilter ?? admin?.preferences?.membersFilter;
  const [members, setMembers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [filterStatus, setFilterStatus] = useState(savedFilter?.paymentStatus || "all");
  const [filterGender, setFilterGender] = useState(savedFilter?.gender || "all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState("daysLeft");
  const [sortOrder, setSortOrder] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [showDeletePopup, setShowDeletePopup] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [deleteMemberCode, setDeleteMemberCode] = useState(null);
  const [showRenewPopup, setShowRenewPopup] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [showEditPopup, setShowEditPopup] = useState(false);
  const [selectedEditMember, setSelectedEditMember] = useState(null);
  const [editLoadingGymId, setEditLoadingGymId] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editSubmitError, setEditSubmitError] = useState(null);
  const [renewMode, setRenewMode] = useState(false);
  const [renewSubmitting, setRenewSubmitting] = useState(false);
  const [renewError, setRenewError] = useState(null);
  const [renewLoadingGymId, setRenewLoadingGymId] = useState(null);
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
  const searchTimerRef = useRef(null);
  const abortRef = useRef(null);

  // Server-driven fetch: filters, sort + pagination are resolved by the backend.
  // Serves a recent cache entry immediately (no blank/"0 members" flash when
  // navigating back to this page), then refreshes in the background.
  const loadMembers = useCallback(async () => {
    // Abort any in-flight request so a stale response can never overwrite a
    // newer one (e.g. rapid filter/sort/page changes).
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Scope is included so a gender-scoped trainer never sees (or overwrites)
    // a superadmin's cached results for the same filter combination.
    const cacheKey = `${admin?.scope || "all"}|${page}|${pageSize}|${filterGender}|${filterStatus}|${debouncedSearch}|${sortBy}|${sortOrder}`;
    const cached = memberListCache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.data.length > 0) {
      // Render cached data immediately; the background refresh below keeps it fresh.
      setMembers(cached.data);
      setTotal(cached.total);
      setLoading(false);
      setLoadError(null);
    } else {
      setLoading(true);
      setLoadError(null);
    }

    try {
      const params = { page, pageSize, sortBy, sortOrder };
      if (filterGender !== "all") params.gender = filterGender;
      if (filterStatus !== "all") params.paymentStatus = filterStatus;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const res = await apiClient.get("/members", { params, signal: controller.signal });
      const data = res.data?.data || [];
      const totalCount = res.data?.pagination?.total ?? 0;
      memberListCache.set(cacheKey, { data, total: totalCount, fetchedAt: Date.now() });
      setMembers(data);
      setTotal(totalCount);
      setLoadError(null);
    } catch (err) {
      if (err.code === "ERR_CANCELED") return;
      console.log("Error loading members:", err);
      // Keep showing cached data if a background refresh failed.
      if (!(cached && cached.data.length > 0)) {
        setLoadError("Failed to load members. Please try again.");
        setMembers([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterGender, filterStatus, debouncedSearch, sortBy, sortOrder, admin?.scope]);

  useEffect(() => {
    loadPackages();
  }, []);

  // Fetch members whenever page/filter/sort changes. loadMembers aborts any
  // in-flight request before starting a new one, so the React StrictMode
  // double-mount simply results in one aborted request and one completed
  // request — never in a skipped fetch that leaves the list empty.
  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // Clean up the debounce timer and abort any in-flight request on unmount.
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const loadPackages = async () => {
    try {
      const res = await apiClient.get("/packages");
      setPackages(res.data?.data || res.data || []);
    } catch (err) {
      console.log("Error loading packages:", err);
    }
  };

  // Persist the calling admin's filter preference: update the in-session map so
  // navigation within this session restores it immediately, and save to the
  // admin's server-side preferences so it survives logout/login and devices.
  // Fire-and-forget — the UI still applies the filter this session even if
  // persistence fails.
  const saveFilterPreferences = useCallback(async (paymentStatus, gender) => {
    if (adminId) membersFilterMemory.set(adminId, { paymentStatus, gender });
    try {
      await apiClient.put("/admin/preferences", {
        membersFilter: { paymentStatus, gender },
      });
    } catch {
      // Non-fatal: filter state still applies for this session.
    }
  }, [adminId]);

  const changeGender = (value) => {
    setFilterGender(value);
    setPage(1);
    saveFilterPreferences(filterStatus, value);
  };

  const changeStatus = (value) => {
    setFilterStatus(value);
    setPage(1);
    saveFilterPreferences(value, filterGender);
  };

  const changePageSize = (value) => {
    setPageSize(Number(value));
    setPage(1);
  };

  // Debounced search — no request per keystroke. Resets to page 1.
  const handleSearchChange = (value) => {
    setSearch(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
  };

  // Column-header sorting: clicking the active column toggles direction;
  // clicking a different column makes it the active sort (ascending first).
  const toggleSort = (sb) => {
    if (sortBy === sb) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(sb);
      setSortOrder("asc");
    }
    setPage(1);
  };

  // Neutral ⇅ on inactive sortable columns; ↑/↓ on the active one — makes it
  // obvious which columns can be sorted by clicking.
  const sortIndicator = (sb) => {
    if (sortBy === sb) return sortOrder === "asc" ? "↑" : "↓";
    return "⇅";
  };

  const clearFilters = () => {
    setFilterStatus("all");
    setFilterGender("all");
    setSearch("");
    setDebouncedSearch("");
    setSortBy("daysLeft");
    setSortOrder("asc");
    setPage(1);
    saveFilterPreferences("all", "all");
  };

  const goToPage = (target) => setPage(target);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const closeEditModal = () => {
    setShowEditPopup(false);
    setSelectedEditMember(null);
    setEditSubmitting(false);
    setEditSubmitError(null);
  };

  const openEditModal = async (gymId, memberCode) => {
    setEditSubmitError(null);
    setEditLoadingGymId(gymId);
    try {
      const codeParam = memberCode ? `?memberCode=${encodeURIComponent(memberCode)}` : "";
      const res = await apiClient.get(`/members/${gymId}${codeParam}`);
      const member = res.data?.data || res.data;
      if (!member || !member._id) {
        throw new Error("Member data not found");
      }
      setSelectedEditMember(member);
      setShowEditPopup(true);
    } catch (err) {
      console.error("Failed to load member details for edit:", err);
      alert(err.response?.data?.message || err.message || "Unable to load member details");
    } finally {
      setEditLoadingGymId(null);
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

  const confirmDelete = (gymId, memberCode) => {
    setDeleteId(gymId);
    setDeleteMemberCode(memberCode || null);
    setShowDeletePopup(true);
  };

  const deleteMember = async () => {
    try {
      await apiClient.delete(`/members/${deleteId}`, { data: { memberCode: deleteMemberCode } });
      setShowDeletePopup(false);
      await loadMembers();
      alert("Member deleted successfully");
    } catch (err) {
      alert("Delete failed");
      console.log(err);
    }
  };

  const openRenew = async (gymId, memberCode) => {
    setRenewError(null);
    setRenewLoadingGymId(gymId);
    try {
      const codeParam = memberCode ? `?memberCode=${encodeURIComponent(memberCode)}` : "";
      const res = await apiClient.get(`/members/${gymId}${codeParam}`);
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
      setRenewLoadingGymId(null);
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
      issuer: admin?.fullName || admin?.username || "Giri Gym Admin",
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
      // Optimistic concurrency: version this renewal is based on.
      version: selectedMember.version,
      // Disambiguator when duplicate gymIds exist (superadmin).
      memberCode: selectedMember.memberCode || undefined,
    };

    if (renewData.includeDiet && renewData.dietId) {
      body.dietId = renewData.dietId;
      body.dietIncludedInLastBilling = "true";
    }

    try {
      setRenewSubmitting(true);
      await apiClient.put(`/members/renew/${selectedMember.gymId}`, body);
      const codeParam = selectedMember.memberCode ? `?memberCode=${encodeURIComponent(selectedMember.memberCode)}` : "";
      const refreshed = await apiClient.get(`/members/${selectedMember.gymId}${codeParam}`);
      const renewedMember = refreshed.data?.data || refreshed.data;

      downloadMembershipInvoice({
        member: renewedMember,
        mode: "renew",
        issuer: admin?.fullName || admin?.username || "Giri Gym Admin",
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
      const errorMsg =
        err.response?.status === 409
          ? "This member was modified by another user. Please reload and try again."
          : err.response?.data?.message || err.message || "Renewal failed. Please try again.";
      setRenewSubmitError(errorMsg);
    } finally {
      setRenewSubmitting(false);
    }
  };

  const submitMemberUpdate = async (updated) => {
    if (!selectedEditMember) {
      return;
    }

    const normalizedGymId = selectedEditMember.gymId;
    setEditSubmitting(true);
    setEditSubmitError(null);

    try {
      const fd = new FormData();
      Object.keys(updated).forEach((key) => {
        if (key !== "photo" && key !== "customFields") {
          fd.append(key, updated[key]);
        }
      });
      if (updated.photo instanceof File) {
        fd.append("photo", updated.photo);
      }
      fd.append("customFields", JSON.stringify(updated.customFields || {}));

      await apiClient.put(`/members/${normalizedGymId}`, fd);

      await loadMembers();
      closeEditModal();
      alert("Member details updated successfully");
    } catch (err) {
      console.error("Update failed:", err);
      const errorMsg =
        err.response?.status === 409
          ? "This member was modified by another user. Please reload and try again."
          : err.response?.data?.message || err.message || "Update failed. Please try again.";
      setEditSubmitError(errorMsg);
    } finally {
      setEditSubmitting(false);
    }
  };

  const rows = members.map((member) => ({
    ...member,
    daysLeft: getDaysRemaining(member.validTill || member.validityEnd),
  }));

  return (
    <div className="saas-container">
      <div className="members-page-header">
        <div>
          <h1>All Members{!loading ? ` · ${total} member${total === 1 ? "" : "s"}` : ""}</h1>
          <p>Manage registered members and memberships.</p>
        </div>
        <button
          className="btn-primary members-register-btn"
          onClick={() => navigate("/admin/register")}
        >
          <FiUserPlus size={15} strokeWidth={2.5} aria-hidden="true" />
          Register Member
        </button>
        {admin?.scope === "all" && (
          <button
            className="btn-secondary members-import-btn"
            onClick={() => setImportModalOpen(true)}
          >
            Import Members
          </button>
        )}
      </div>

      {renewError && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 mb-6">
          {renewError}
        </div>
      )}

      <div className="members-toolbar">
        <div className="members-toolbar-filters">
          <select className="saas-input" value={filterStatus} onChange={(e) => changeStatus(e.target.value)} aria-label="Payment status">
            <option value="all">View All Statuses</option>
            <option value="paid">Paid</option>
            <option value="not_paid">Not Paid</option>
          </select>
          {admin?.scope === "all" && (
            <select className="saas-input" value={filterGender} onChange={(e) => changeGender(e.target.value)} aria-label="Gender">
              <option value="all">View All Genders</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Transgender">Transgender</option>
            </select>
          )}
          <div className="members-search">
            <svg className="members-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search name, phone, gym ID…"
              aria-label="Search members"
            />
          </div>
        </div>
      </div>

      <div className="saas-table-container members-table">
        <table className="saas-table">
          <thead>
            <tr>
              <th>MEMBER REF</th>
              <th
                className="members-sortable"
                onClick={() => toggleSort("name")}
                aria-sort={sortBy === "name" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
              >
                Member <span className="members-sort-icon">{sortIndicator("name")}</span>
              </th>
              <th>Phone</th>
              <th
                className="members-sortable"
                onClick={() => toggleSort("validTill")}
                aria-sort={sortBy === "validTill" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
              >
                Valid Till <span className="members-sort-icon">{sortIndicator("validTill")}</span>
              </th>
              <th
                className="members-sortable"
                onClick={() => toggleSort("daysLeft")}
                aria-sort={sortBy === "daysLeft" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
              >
                Days Left <span className="members-sort-icon">{sortIndicator("daysLeft")}</span>
              </th>
              <th
                className="members-sortable"
                onClick={() => toggleSort("plan")}
                aria-sort={sortBy === "plan" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
              >
                Plan <span className="members-sort-icon">{sortIndicator("plan")}</span>
              </th>
              <th>Payment</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="members-skeleton-row">
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j}><div className="members-skeleton" /></td>
                  ))}
                </tr>
              ))
            ) : loadError ? (
              <tr>
                <td colSpan="8">
                  <div className="members-empty">
                    <p className="members-empty-title">Unable to load members</p>
                    <p className="members-empty-sub">Please try again.</p>
                    <button className="btn-secondary" onClick={loadMembers} style={{ minHeight: 0, padding: "8px 14px", fontSize: "13px" }}>
                      Retry
                    </button>
                  </div>
                </td>
              </tr>
            ) : rows.map((member) => (
              <tr key={member._id}>
                <td>{memberRefFor(member)}</td>
                <td className="members-cell-name">{member.name || member.fullName}</td>
                <td>{member.phone}</td>
                <td>{formatDate(member.validTill || member.validityEnd)}</td>
                <td>
                  <span className={getDaysIndicatorClass(member.daysLeft)}>
                    {member.daysLeft} days
                  </span>
                </td>
                <td>{member.plan || member.gymPlan}</td>
                <td>
                  <span className={`saas-badge-pill ${member.paymentStatus === 'paid' ? 'saas-badge-success' : 'saas-badge-warning'}`}>
                    {member.paymentStatus.replace('_', ' ').toUpperCase()}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div className="flex justify-center items-center gap-2">
                    <IconButton
                      type="refresh"
                      onClick={() => openRenew(member.gymId, member.memberCode)}
                      title="Renew membership"
                      disabled={renewLoadingGymId === member.gymId}
                      className={renewLoadingGymId === member.gymId ? "cursor-wait" : ""}
                    />
                    <IconButton
                      type="edit"
                      onClick={() => openEditModal(member.gymId, member.memberCode)}
                      title="Edit member details"
                      disabled={editLoadingGymId === member.gymId}
                    />
                    {isSuperadmin && (
                      <IconButton
                        type="delete"
                        onClick={() => confirmDelete(member.gymId, member.memberCode)}
                        title="Delete member"
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {!loading && !loadError && rows.length === 0 && (
              <tr>
                <td colSpan="8">
                  <div className="members-empty">
                    <p className="members-empty-title">No members found</p>
                    <p className="members-empty-sub">No members match the selected filters.</p>
                    <button className="btn-secondary" onClick={clearFilters} style={{ minHeight: 0, padding: "8px 14px", fontSize: "13px" }}>
                      Clear filters
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="members-cards">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="members-card">
              <div className="members-skeleton" style={{ width: "40%", height: 16 }} />
              <div className="members-skeleton" style={{ width: "70%" }} />
              <div className="members-skeleton" style={{ width: "55%" }} />
            </div>
          ))
        ) : loadError ? (
          <div className="members-empty" style={{ border: "1px solid var(--border-color)", borderRadius: "10px" }}>
            <p className="members-empty-title">Unable to load members</p>
            <p className="members-empty-sub">Please try again.</p>
            <button className="btn-secondary" onClick={loadMembers} style={{ minHeight: 0, padding: "8px 14px", fontSize: "13px" }}>
              Retry
            </button>
          </div>
        ) : rows.map((member) => (
          <div key={member._id} className="members-card">
            <div className="members-card-top">
              <span className="members-card-id">{memberRefFor(member)}</span>
              <span className="members-card-name">{member.name || member.fullName}</span>
            </div>
            <div className="members-card-sub">{member.phone}</div>
            <div className="members-card-meta">
              <span className={getDaysIndicatorClass(member.daysLeft)}>{member.daysLeft} days</span>
              <span className="members-card-plan">{member.plan || member.gymPlan}</span>
              <span className={`saas-badge-pill ${member.paymentStatus === 'paid' ? 'saas-badge-success' : 'saas-badge-warning'}`}>
                {member.paymentStatus.replace('_', ' ').toUpperCase()}
              </span>
            </div>
            <div className="members-card-actions">
              <IconButton type="refresh" onClick={() => openRenew(member.gymId, member.memberCode)} title="Renew membership" />
              <IconButton type="edit" onClick={() => openEditModal(member.gymId, member.memberCode)} title="Edit member details" />
              {isSuperadmin && <IconButton type="delete" onClick={() => confirmDelete(member.gymId, member.memberCode)} title="Delete member" />}
            </div>
          </div>
        ))}

        {!loading && !loadError && rows.length === 0 && (
          <div className="members-empty" style={{ border: "1px dashed var(--border-color)", borderRadius: "10px" }}>
            <p className="members-empty-title">No members found</p>
            <p className="members-empty-sub">No members match the selected filters.</p>
            <button className="btn-secondary" onClick={clearFilters} style={{ minHeight: 0, padding: "8px 14px", fontSize: "13px" }}>
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Pagination + result summary (server-driven) */}
      {!loading && !loadError && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <span className="text-sm text-[var(--text-secondary)]">
            Page {page} of {totalPages} · {total} member{total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <label className="text-sm text-[var(--text-secondary)]" htmlFor="members-page-size">Per page</label>
            <select
              id="members-page-size"
              className="saas-input"
              style={{ width: '90px' }}
              value={pageSize}
              onChange={(e) => changePageSize(e.target.value)}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="saas-input"
              style={{ cursor: page <= 1 ? "not-allowed" : "pointer", width: '90px' }}
            >
              ← Prev
            </button>
            <span className="text-sm text-[var(--text-primary)]" style={{ minWidth: '48px', textAlign: 'center' }}>{page}</span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="saas-input"
              style={{ cursor: page >= totalPages ? "not-allowed" : "pointer", width: '90px' }}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {showDeletePopup && (
        <div className="modal-shell" onClick={() => setShowDeletePopup(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="section-heading">
                <span className="eyebrow">Confirm Delete</span>
                <h3 className="panel-title">This will permanently remove the member?</h3>
              </div>
              <button type="button" onClick={() => setShowDeletePopup(false)} className="icon-close-btn" aria-label="Close delete modal">
                ✕
              </button>
            </div>
            <div className="modal-content">
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
        </div>
      )}

      {showEditPopup && selectedEditMember && (
        <div className="modal-shell" onClick={closeEditModal}>
          <div className="modal-card" style={{ width: "min(100%, 860px)" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="section-heading">
                <span className="eyebrow">Edit Member</span>
                <h3 className="panel-title">{selectedEditMember.fullName || selectedEditMember.name || 'Member details'}</h3>
                <p className="panel-subtitle">Gym ID {selectedEditMember.gymId}</p>
              </div>
              <button type="button" onClick={closeEditModal} className="icon-close-btn" aria-label="Close edit modal">
                ✕
              </button>
            </div>

            <div className="modal-content">
              {editSubmitError && (
                <div className="modal-error">
                  {editSubmitError}
                </div>
              )}

              <RegisterForm
                defaultData={selectedEditMember}
                onSubmit={submitMemberUpdate}
                buttonLabel={editSubmitting ? 'Saving...' : 'Save Changes'}
              />
            </div>
          </div>
        </div>
      )}

      {showRenewPopup && selectedMember && (
        <div className="modal-shell" onClick={closeRenewModal}>
          <div className="modal-card" style={{ width: "min(100%, 860px)" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="section-heading">
                <span className="eyebrow">Membership Billing</span>
                <h3 className="panel-title">{selectedMember.fullName}</h3>
                <p className="panel-subtitle">Gym ID {selectedMember.gymId}</p>
              </div>

              <button type="button" onClick={closeRenewModal} className="icon-close-btn" aria-label="Close renew modal">
                ✕
              </button>
            </div>

            <div className="modal-content">
              <div className="modal-subheader">
                <div className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] px-4 py-3">
                  <ToggleSwitch active={renewMode} onClick={(val) => handleModeToggle(val)} />
                  <span className="font-semibold text-white">{renewMode ? "Renew Mode" : "Bill Mode"}</span>
                </div>
              </div>

            <div className="modal-body form-grid-2 mt-6 custom-scrollbar">
              <div className="panel" style={{ padding: "20px", background: "var(--surface-muted)" }}>
                <div className="section-stack" style={{ gap: "8px" }}>
                  <p className="muted-copy">Phone: {selectedMember.phone}</p>
                  <p className="muted-copy">Registration Date: {formatDate(selectedMember.joiningDate || selectedMember.createdAt)}</p>
                  <p className="muted-copy">Current Validity: {formatDate(selectedMember.validityEnd)}</p>
                  <p className="muted-copy">Current Plan: {selectedMember.gymPlan || "-"}</p>
                  <p className="muted-copy">Training Type: {selectedMember.trainingType || "-"}</p>
                  <p className="muted-copy">Issued By: {admin?.fullName || admin?.username || "Admin"}</p>
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

      {importModalOpen && (
        <MemberImportModal
          isOpen={importModalOpen}
          onClose={() => {
            setImportModalOpen(false);
            loadMembers();
          }}
        />
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
