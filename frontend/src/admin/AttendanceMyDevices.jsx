import { useCallback, useEffect, useState } from "react";
import { FiLock, FiPauseCircle, FiPlus, FiRefreshCcw, FiUnlock } from "react-icons/fi";
import apiClient from "../utils/apiClient.js";
import {
  getOrCreateBrowserDeviceId,
  setKioskIdentity,
  clearKioskIdentity,
} from "../utils/kioskIdentity.js";
import { useAdmin } from "./authContext.js";
import {
  PageHeader,
  SectionHeader,
  StatusBadge,
} from "./components/ui/DeviceComponents.jsx";
import ActivateDeviceModal from "./components/ActivateDeviceModal.jsx";

function fmtShort(dt) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function scopeLabel(scope) {
  return scope === "male"
    ? "Male"
    : scope === "female_plus_transgender"
    ? "Female + Transgender"
    : scope === "all"
    ? "All"
    : scope || "—";
}

function shortDeviceId(id) {
  if (!id) return "—";
  if (id.length <= 18) return id;
  return `${id.slice(0, 10)}…${id.slice(-4)}`;
}

// Lifecycle state for a registration row. `deactivationReason` is stamped
// server-side and is authoritative (never derived from UI assumptions alone):
//   "trainer"           → reactivatable by the owning Trainer
//   "replaced"          → terminal (superseded by a newer registration)
//   "revoked"           → terminal (Super Admin revoke)
//   "scope_reassigned"  → terminal (Super Admin scope change)
// Legacy rows with no deactivationReason are treated as non-reactivatable.
function inactiveInfo(d) {
  if (d.revokedAt) {
    return {
      label: d.deactivationReason === "scope_reassigned" ? "Scope Reassigned" : "Revoked",
      cls: "badge-muted",
      reactivatable: false,
    };
  }
  if (d.deactivationReason === "replaced") {
    return { label: "Replaced", cls: "badge-muted", reactivatable: false };
  }
  if (d.deactivationReason === "trainer") {
    return { label: "Deactivated", cls: "badge-muted", reactivatable: true };
  }
  return { label: "Deactivated", cls: "badge-muted", reactivatable: false };
}

export default function AttendanceMyDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyAction, setBusyAction] = useState(null);

  // Activation modal visibility
  const [activationOpen, setActivationOpen] = useState(false);

  // Authenticated trainer profile — source of the attendance scope (the
  // /admin/devices/my payload does not include it).
  const admin = useAdmin();

  const browserDeviceId = getOrCreateBrowserDeviceId();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient.get("/admin/devices/my");
      setDevices(res.data?.registrations || res.data?.activations || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load your attendance devices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openActivation = () => {
    setActivationOpen(true);
    setError("");
    setSuccess("");
  };

  const closeActivation = () => {
    setActivationOpen(false);
  };

  const handleActivate = async ({ mode, code, qrSecret, password }) => {
    const res = await apiClient.post("/admin/devices/activate", {
      code: mode === "code" ? code : undefined,
      qrSecret: mode === "qr" ? qrSecret : undefined,
      password,
      browserDeviceId,
    });
    const { registration, apiKey } = res.data || {};
    if (registration?.kioskId && apiKey) {
      setKioskIdentity(registration.kioskId, apiKey);
    }
    closeActivation();
    setSuccess("Device activated. The customer attendance page is now ready.");
    await fetchData();
  };

  const lockDevice = async (registrationId) => {
    if (busyAction) return;
    setBusyAction(`lock-${registrationId}`);
    setError("");
    setSuccess("");
    try {
      await apiClient.post(`/admin/devices/${registrationId}/lock`);
      setSuccess("Device locked. Customer attendance is paused on this browser.");
      await fetchData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to lock the device.");
    } finally {
      setBusyAction(null);
    }
  };

  const unlockDevice = async (registrationId) => {
    if (busyAction) return;
    setBusyAction(`unlock-${registrationId}`);
    setError("");
    setSuccess("");
    try {
      await apiClient.post(`/admin/devices/${registrationId}/unlock`);
      setSuccess("Device unlocked. Customer attendance is active on this browser.");
      await fetchData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to unlock the device.");
    } finally {
      setBusyAction(null);
    }
  };

  const deactivateDevice = async (registrationId) => {
    if (busyAction) return;
    const ok = window.confirm(
      "Deactivate this device?\n\n" +
      "This temporarily stops attendance on this device. " +
      "You can reactivate this same device later without a new administrator activation code. " +
      "It will remain unavailable for attendance while deactivated."
    );
    if (!ok) return;
    setBusyAction(`deactivate-${registrationId}`);
    setError("");
    setSuccess("");
    try {
      await apiClient.post(`/admin/devices/${registrationId}/deactivate`);
      clearKioskIdentity();
      setSuccess("Device deactivated. Attendance is paused on this browser. You can reactivate it later from this page.");
      await fetchData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to deactivate the device.");
    } finally {
      setBusyAction(null);
    }
  };

  const reactivateDevice = async (registrationId) => {
    if (busyAction) return;
    setBusyAction(`reactivate-${registrationId}`);
    setError("");
    setSuccess("");
    try {
      const res = await apiClient.post(`/admin/devices/${registrationId}/reactivate`);
      const { registration, apiKey } = res.data || {};
      if (registration?.kioskId && apiKey) {
        setKioskIdentity(registration.kioskId, apiKey);
      }
      setSuccess("Device reactivated. Customer attendance is active on this browser.");
      await fetchData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to reactivate the device.");
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return <div className="saas-container"><p className="muted-copy">Loading your devices...</p></div>;
  }

  const activeDevice = devices.find((d) => d.active);
  const inactiveDevices = devices.filter((d) => !d.active);
  const scope = activeDevice?.scope || admin?.scope;

  return (
    <div className="saas-container">
      <PageHeader
        title="My Attendance Device"
        description="Manage the device you use for customer attendance."
        actions={
          <button
            type="button"
            className="btn-primary min-h-9 gap-1.5 px-3.5 text-[13.5px] font-semibold"
            onClick={openActivation}
            title={activeDevice ? "Replace your attendance device" : "Activate an attendance device"}
          >
            {activeDevice ? (
              <>
                <FiRefreshCcw size={14} aria-hidden="true" />
                Replace Device
              </>
            ) : (
              <>
                <FiPlus size={14} aria-hidden="true" />
                Activate Device
              </>
            )}
          </button>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      <SectionHeader title="My Devices" sub="Your current and previous attendance devices." />
      <div className="saas-table-container device-table" style={{ marginBottom: 16 }}>
        <table className="saas-table">
          <thead>
            <tr>
              <th scope="col">Device</th>
              <th scope="col">Status</th>
              <th scope="col">Activated</th>
              <th scope="col">Ended</th>
              <th scope="col" className="device-col-actions">Action</th>
            </tr>
          </thead>
          <tbody>
            {activeDevice ? (
              <tr key={activeDevice.registrationId} style={{ background: "var(--accent-soft, rgba(212,175,55,0.06))" }}>
                <td className="device-col-device" title={activeDevice.browserDeviceId || ""}>
                  {activeDevice.deviceLabel || "This browser"}
                </td>
                <td>
                  {activeDevice.locked ? (
                    <StatusBadge label="Locked" cls="badge-muted" />
                  ) : (
                    <StatusBadge label="Active" cls="badge-active" />
                  )}
                </td>
                <td className="device-col-date">{fmtShort(activeDevice.activatedAt)}</td>
                <td className="device-col-date">{activeDevice.locked && activeDevice.lockedAt ? fmtShort(activeDevice.lockedAt) : "—"}</td>
                <td className="device-col-actions">
                  {activeDevice.locked ? (
                    <button
                      type="button"
                      className="btn-ghost min-h-0 px-2 py-1 text-xs"
                      disabled={busyAction === `unlock-${activeDevice.registrationId}`}
                      onClick={() => unlockDevice(activeDevice.registrationId)}
                      title="Unlock this device"
                    >
                      <FiUnlock size={12} aria-hidden="true" />
                      {busyAction === `unlock-${activeDevice.registrationId}` ? "Unlocking…" : "Unlock"}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn-ghost min-h-0 px-2 py-1 text-xs"
                        disabled={busyAction === `lock-${activeDevice.registrationId}`}
                        onClick={() => lockDevice(activeDevice.registrationId)}
                        title="Lock this device"
                      >
                        <FiLock size={12} aria-hidden="true" />
                        {busyAction === `lock-${activeDevice.registrationId}` ? "Locking…" : "Lock"}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost min-h-0 px-2 py-1 text-xs"
                        disabled={busyAction === `deactivate-${activeDevice.registrationId}`}
                        onClick={() => deactivateDevice(activeDevice.registrationId)}
                        title="Deactivate this device (you can reactivate it later)"
                      >
                        <FiPauseCircle size={12} aria-hidden="true" />
                        {busyAction === `deactivate-${activeDevice.registrationId}` ? "Deactivating…" : "Deactivate"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan="5" style={{ padding: "14px 16px", color: "var(--text-muted)" }}>
                  No active attendance device. Use <strong>Activate Device</strong> above to begin.
                </td>
              </tr>
            )}
            {inactiveDevices.map((d) => {
              const info = inactiveInfo(d);
              return (
                <tr key={d.registrationId}>
                  <td className="device-col-device" title={d.browserDeviceId || ""}>
                    {d.deviceLabel || shortDeviceId(d.browserDeviceId)}
                  </td>
                  <td>
                    <StatusBadge label={info.label} cls={info.cls} />
                  </td>
                  <td className="device-col-date">{fmtShort(d.activatedAt)}</td>
                  <td className="device-col-date">{fmtShort(d.deactivatedAt || d.revokedAt)}</td>
                  <td className="device-col-actions">
                    {info.reactivatable ? (
                      <button
                        type="button"
                        className="btn-ghost min-h-0 px-2 py-1 text-xs"
                        disabled={busyAction === `reactivate-${d.registrationId}`}
                        onClick={() => reactivateDevice(d.registrationId)}
                        title="Reactivate this device (no Super Admin code needed)"
                      >
                        <FiRefreshCcw size={12} aria-hidden="true" />
                        {busyAction === `reactivate-${d.registrationId}` ? "Reactivating…" : "Reactivate"}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile — compact stacked rows */}
      <div className="device-stack">
        {activeDevice ? (
          <div key={activeDevice.registrationId} className="device-stack-row" style={{ borderColor: "var(--accent)" }}>
            <div className="device-stack-top">
              <span className="device-stack-name">
                {activeDevice.deviceLabel || "This browser"}
              </span>
              {activeDevice.locked ? (
                <StatusBadge label="Locked" cls="badge-muted" />
              ) : (
                <StatusBadge label="Active" cls="badge-active" />
              )}
            </div>
            <div className="device-stack-meta">
              {scopeLabel(scope)} · {activeDevice.locked ? `Locked ${fmtShort(activeDevice.lockedAt)}` : `Activated ${fmtShort(activeDevice.activatedAt)}`}
            </div>
            <div className="device-stack-actions">
              {activeDevice.locked ? (
                <button
                  type="button"
                  className="btn-ghost min-h-0 px-2 py-1 text-xs"
                  disabled={busyAction === `unlock-${activeDevice.registrationId}`}
                  onClick={() => unlockDevice(activeDevice.registrationId)}
                  title="Unlock this device"
                >
                  <FiUnlock size={12} aria-hidden="true" />
                  {busyAction === `unlock-${activeDevice.registrationId}` ? "Unlocking…" : "Unlock"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-ghost min-h-0 px-2 py-1 text-xs"
                    disabled={busyAction === `lock-${activeDevice.registrationId}`}
                    onClick={() => lockDevice(activeDevice.registrationId)}
                    title="Lock this device"
                  >
                    <FiLock size={12} aria-hidden="true" />
                    {busyAction === `lock-${activeDevice.registrationId}` ? "Locking…" : "Lock"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost min-h-0 px-2 py-1 text-xs"
                    disabled={busyAction === `deactivate-${activeDevice.registrationId}`}
                    onClick={() => deactivateDevice(activeDevice.registrationId)}
                    title="Deactivate this device (you can reactivate it later)"
                  >
                    <FiPauseCircle size={12} aria-hidden="true" />
                    {busyAction === `deactivate-${activeDevice.registrationId}` ? "Deactivating…" : "Deactivate"}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="device-stack-row" style={{ marginBottom: 8 }}>
            <div className="device-stack-top">
              <span className="device-stack-name">No active attendance device</span>
            </div>
            <div className="device-stack-meta">
              Ask the administrator for a one-time activation code, then use Activate Device.
            </div>
          </div>
        )}
        {inactiveDevices.map((d) => {
          const info = inactiveInfo(d);
          return (
            <div key={d.registrationId} className="device-stack-row">
              <div className="device-stack-top">
                <span className="device-stack-name">
                  {d.deviceLabel || shortDeviceId(d.browserDeviceId)}
                </span>
                <StatusBadge label={info.label} cls={info.cls} />
              </div>
              <div className="device-stack-meta">
                Activated {fmtShort(d.activatedAt)} · Ended {fmtShort(d.deactivatedAt || d.revokedAt)}
              </div>
              {info.reactivatable ? (
                <div className="device-stack-actions">
                  <button
                    type="button"
                    className="btn-ghost min-h-0 px-2 py-1 text-xs"
                    disabled={busyAction === `reactivate-${d.registrationId}`}
                    onClick={() => reactivateDevice(d.registrationId)}
                    title="Reactivate this device (no Super Admin code needed)"
                  >
                    <FiRefreshCcw size={12} aria-hidden="true" />
                    {busyAction === `reactivate-${d.registrationId}` ? "Reactivating…" : "Reactivate"}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <ActivateDeviceModal
        key={activationOpen ? "open" : "closed"}
        open={activationOpen}
        onClose={closeActivation}
        onActivate={handleActivate}
      />
    </div>
  );
}