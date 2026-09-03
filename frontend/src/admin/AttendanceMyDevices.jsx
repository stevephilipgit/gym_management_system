import { useCallback, useEffect, useState } from "react";
import { FiAlertTriangle, FiPlus, FiRefreshCcw, FiTrash2 } from "react-icons/fi";
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

  const [confirmDeactivate, setConfirmDeactivate] = useState(null);

  const deactivateDevice = async (registrationId) => {
    if (busyAction) return;
    setBusyAction(`deactivate-${registrationId}`);
    setError("");
    setSuccess("");
    try {
      await apiClient.post(`/admin/devices/${registrationId}/deactivate`);
      clearKioskIdentity();
      setConfirmDeactivate(null);
      setSuccess("Device deactivated. The customer attendance page is disabled on this browser.");
      await fetchData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to deactivate the device.");
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
                  <StatusBadge label="Active" cls="badge-active" />
                </td>
                <td className="device-col-date">{fmtShort(activeDevice.activatedAt)}</td>
                <td className="device-col-date">—</td>
                <td className="device-col-actions">
                  <button
                    type="button"
                    className="btn-ghost min-h-0 px-2 py-1 text-xs"
                    onClick={() => setConfirmDeactivate(activeDevice.registrationId)}
                    title="Deactivate this device"
                  >
                    <FiTrash2 size={12} aria-hidden="true" />
                    Deactivate
                  </button>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan="5" style={{ padding: "14px 16px", color: "var(--text-muted)" }}>
                  No active attendance device. Use <strong>Activate Device</strong> above to begin.
                </td>
              </tr>
            )}
            {inactiveDevices.map((d) => (
              <tr key={d.registrationId}>
                <td className="device-col-device" title={d.browserDeviceId || ""}>
                  {d.deviceLabel || shortDeviceId(d.browserDeviceId)}
                </td>
                <td>
                  <StatusBadge label={d.revokedAt ? "Revoked" : "Deactivated"} cls="badge-muted" />
                </td>
                <td className="device-col-date">{fmtShort(d.activatedAt)}</td>
                <td className="device-col-date">{fmtShort(d.deactivatedAt || d.revokedAt)}</td>
                <td className="device-col-actions">—</td>
              </tr>
            ))}
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
              <StatusBadge label="Active" cls="badge-active" />
            </div>
            <div className="device-stack-meta">
              {scopeLabel(scope)} · Activated {fmtShort(activeDevice.activatedAt)}
            </div>
            <div className="device-stack-actions">
              <button
                type="button"
                className="btn-ghost min-h-0 px-2 py-1 text-xs"
                onClick={() => setConfirmDeactivate(activeDevice.registrationId)}
                title="Deactivate this device"
              >
                <FiTrash2 size={12} aria-hidden="true" />
                Deactivate
              </button>
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
        {inactiveDevices.map((d) => (
          <div key={d.registrationId} className="device-stack-row">
            <div className="device-stack-top">
              <span className="device-stack-name">
                {d.deviceLabel || shortDeviceId(d.browserDeviceId)}
              </span>
              <StatusBadge label={d.revokedAt ? "Revoked" : "Deactivated"} cls="badge-muted" />
            </div>
            <div className="device-stack-meta">
              Activated {fmtShort(d.activatedAt)} · Ended {fmtShort(d.deactivatedAt || d.revokedAt)}
            </div>
          </div>
        ))}
      </div>
      {confirmDeactivate ? (
        <div className="modal-shell" onClick={() => setConfirmDeactivate(null)}>
          <div className="modal-card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Deactivate device?</h2>
              </div>
              <button type="button" className="icon-close-btn" onClick={() => setConfirmDeactivate(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-content">
              <div className="adm-activate-modal__notice" style={{ marginBottom: 16 }}>
                <FiAlertTriangle aria-hidden="true" className="adm-activate-modal__notice-icon" />
                <div>
                  <div className="adm-activate-modal__notice-title">This action is permanent</div>
                  <p className="adm-activate-modal__notice-body">
                    Deactivating will invalidate this device's credentials. The customer attendance page will be disabled on this browser. A new activation code from the administrator will be required to use attendance again.
                  </p>
                </div>
              </div>
              <div className="modal-button-row" style={{ justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setConfirmDeactivate(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busyAction === `deactivate-${confirmDeactivate}`}
                  onClick={() => deactivateDevice(confirmDeactivate)}
                >
                  {busyAction === `deactivate-${confirmDeactivate}` ? "Deactivating…" : "Deactivate"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ActivateDeviceModal
        key={activationOpen ? "open" : "closed"}
        open={activationOpen}
        onClose={closeActivation}
        onActivate={handleActivate}
      />
    </div>
  );
}