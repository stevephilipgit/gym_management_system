import { useCallback, useEffect, useState } from "react";
import apiClient from "../utils/apiClient.js";
import {
  getOrCreateBrowserDeviceId,
  setKioskIdentity,
  clearKioskIdentity,
} from "../utils/kioskIdentity.js";
import {
  PageHeader,
  SectionHeader,
  StatusBadge,
  EmptyState,
} from "./components/ui/DeviceComponents.jsx";
import ActivateDeviceModal from "./components/ActivateDeviceModal.jsx";

function fmt(dt) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString();
}

function scopeLabel(scope) {
  return scope === "male"
    ? "Male"
    : scope === "female_plus_transgender"
    ? "Female + Transgender"
    : scope || "—";
}

// QR scan input is encapsulated inside ActivateDeviceModal.

export default function AttendanceMyDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyAction, setBusyAction] = useState(null);

  // Activation modal visibility
  const [activationOpen, setActivationOpen] = useState(false);

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

  return (
    <div className="page-content">
      <PageHeader
        title="My Attendance Device"
        description="Manage the device you use for customer attendance."
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      <SectionHeader title="Current Device" />
      {activeDevice ? (
        <div className="admin-device-card device-active">
          <div className="admin-device-info">
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              This browser is your active attendance device
            </h3>
            <StatusBadge label="Active" cls="badge-active" />
            <span className="muted-copy" style={{ fontSize: 12 }}>
              Scope: {scopeLabel(activeDevice.scope)}
            </span>
            <span className="muted-copy" style={{ fontSize: 12 }}>
              Activated {fmt(activeDevice.activatedAt)}
            </span>
          </div>
          <div className="device-card-actions">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busyAction === `lock-${activeDevice.registrationId}`}
              onClick={() => lockDevice(activeDevice.registrationId)}
            >
              {busyAction === `lock-${activeDevice.registrationId}` ? "Locking..." : "Lock / Deactivate"}
            </button>
          </div>
        </div>
      ) : (
        <EmptyState
          title="No active device"
          description="Ask the gym administrator to generate an activation code, then enter it below."
        >
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={openActivation}>
              Activate Attendance Device
            </button>
          </div>
        </EmptyState>
      )}

      {inactiveDevices.length > 0 ? (
        <>
          <SectionHeader title="Previous Devices" sub="Locked or replaced devices." style={{ marginTop: 24 }} />
          <div className="admin-device-grid">
            {inactiveDevices.slice(0, 5).map((d) => (
              <div key={d.registrationId} className="admin-device-card">
                <div className="admin-device-info">
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Previous device</h3>
                  <StatusBadge label="Locked" cls="badge-muted" />
                  <span className="muted-copy" style={{ fontSize: 12 }}>
                    {fmt(d.deactivatedAt || d.revokedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {activeDevice ? (
        <div style={{ marginTop: 24 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={openActivation}>
            Replace Device
          </button>
          <p className="muted-copy" style={{ fontSize: 11, marginTop: 6 }}>
            Activating a new device will deactivate your previous attendance device.
          </p>
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