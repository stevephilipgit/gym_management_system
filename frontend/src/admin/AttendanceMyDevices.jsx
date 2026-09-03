import { useCallback, useEffect, useState } from "react";
import { FiLock, FiPlus, FiRefreshCcw } from "react-icons/fi";
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
      await apiClient.post(`/admin/devices/${registrationId}/deactivate`);
      // This browser's attendance credential is no longer valid.
      clearKioskIdentity();
      setSuccess("Device locked. The customer attendance page is disabled on this browser.");
      await fetchData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to lock the device.");
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return <div className="page-content"><p className="muted-copy">Loading your devices...</p></div>;
  }

  const activeDevice = devices.find((d) => d.active);
  const inactiveDevices = devices.filter((d) => !d.active);
  const scope = activeDevice?.scope || admin?.scope;

  return (
    <div className="page-content">
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

      <SectionHeader title="Current Device" />
      {activeDevice ? (
        <div className="device-stack-row" style={{ marginBottom: 16 }}>
          <div className="device-stack-top">
            <span className="device-stack-name">
              {activeDevice.deviceLabel || "This browser"}
            </span>
            <StatusBadge label="Active" cls="badge-active" />
          </div>
          <div className="device-stack-meta" title={activeDevice.browserDeviceId || ""}>
            {scopeLabel(scope)} · Activated {fmtShort(activeDevice.activatedAt)} · {shortDeviceId(activeDevice.browserDeviceId)}
          </div>
          <div className="device-stack-actions">
            <button
              type="button"
              className="btn-ghost min-h-0 px-2 py-1 text-xs"
              disabled={busyAction === `lock-${activeDevice.registrationId}`}
              onClick={() => lockDevice(activeDevice.registrationId)}
              title="Lock this device and disable customer attendance on it"
            >
              <FiLock size={12} aria-hidden="true" />
              {busyAction === `lock-${activeDevice.registrationId}` ? "Locking…" : "Lock"}
            </button>
          </div>
        </div>
      ) : (
        <div className="device-stack-row" style={{ marginBottom: 16 }}>
          <div className="device-stack-top">
            <span className="device-stack-name">No active attendance device</span>
          </div>
          <div className="device-stack-meta">
            Ask the administrator for a one-time activation code, then use Activate Device.
          </div>
        </div>
      )}

      <SectionHeader title="Device History" sub="Locked or replaced devices." />
      {inactiveDevices.length === 0 ? (
        <p className="muted-copy" style={{ fontSize: 13, margin: "0 0 16px" }}>No previous devices.</p>
      ) : (
        <>
          {/* Desktop / tablet — compact table */}
          <div className="saas-table-container device-table" style={{ marginBottom: 16 }}>
            <table className="saas-table">
              <thead>
                <tr>
                  <th scope="col">Device</th>
                  <th scope="col">Status</th>
                  <th scope="col">Activated</th>
                  <th scope="col">Ended</th>
                </tr>
              </thead>
              <tbody>
                {inactiveDevices.map((d) => (
                  <tr key={d.registrationId}>
                    <td className="device-col-device" title={d.browserDeviceId || ""}>
                      {d.deviceLabel || shortDeviceId(d.browserDeviceId)}
                    </td>
                    <td>
                      <StatusBadge label={d.revokedAt ? "Revoked" : "Locked"} cls="badge-muted" />
                    </td>
                    <td className="device-col-date">{fmtShort(d.activatedAt)}</td>
                    <td className="device-col-date">{fmtShort(d.deactivatedAt || d.revokedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile — compact stacked rows */}
          <div className="device-stack">
            {inactiveDevices.map((d) => (
              <div key={d.registrationId} className="device-stack-row">
                <div className="device-stack-top">
                  <span className="device-stack-name">
                    {d.deviceLabel || shortDeviceId(d.browserDeviceId)}
                  </span>
                  <StatusBadge label={d.revokedAt ? "Revoked" : "Locked"} cls="badge-muted" />
                </div>
                <div className="device-stack-meta">
                  Activated {fmtShort(d.activatedAt)} · Ended {fmtShort(d.deactivatedAt || d.revokedAt)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ActivateDeviceModal
        key={activationOpen ? "open" : "closed"}
        open={activationOpen}
        onClose={closeActivation}
        onActivate={handleActivate}
      />
    </div>
  );
}