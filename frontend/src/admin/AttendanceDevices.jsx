import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import apiClient from "../utils/apiClient.js";
import {
  PageHeader,
  SectionHeader,
  StatusBadge,
  EmptyState,
  InfoRow,
} from "./components/ui/DeviceComponents.jsx";

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

function fmtCountdown(expiresAt) {
  if (!expiresAt) return "—";
  try {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const mins = Math.ceil(diff / 60000);
    if (mins < 1) return "Expires shortly";
    return `Expires in ~${mins} min`;
  } catch {
    return "—";
  }
}

export default function AttendanceDevices() {
  const [trainers, setTrainers] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyAction, setBusyAction] = useState(null);

  // Activation modal state
  const [modalTrainer, setModalTrainer] = useState(null);
  const [issuedActivation, setIssuedActivation] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [adminsRes, regsRes] = await Promise.all([
        apiClient.get("/admin/list"),
        apiClient.get("/admin/devices/all").catch(() => ({ data: { registrations: [] } })),
      ]);
      const allAdmins = adminsRes.data?.data || [];
      const trainerList = allAdmins.filter((a) => a.role === "trainer");
      setTrainers(trainerList);
      setRegistrations(regsRes.data?.registrations || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load device management data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openActivationModal = (trainer) => {
    setModalTrainer(trainer);
    setIssuedActivation(null);
    setModalError("");
    setCopied(false);
  };

  const closeActivationModal = () => {
    setModalTrainer(null);
    setIssuedActivation(null);
    setModalError("");
    setCopied(false);
  };

  // The backend derives the scope from the authoritative Trainer record. The
  // frontend only sends trainerId — no scope, no physical device, no kioskId.
  const generateActivation = async () => {
    if (!modalTrainer) return;
    setModalLoading(true);
    setModalError("");
    try {
      const res = await apiClient.post("/admin/devices/activate/generate", {
        trainerId: modalTrainer._id,
      });
      setIssuedActivation(res.data?.activation || res.data);
    } catch (err) {
      setModalError(err?.response?.data?.message || "Failed to generate activation code.");
    } finally {
      setModalLoading(false);
    }
  };

  const copyCode = async () => {
    if (!issuedActivation?.code) return;
    try {
      await navigator.clipboard.writeText(issuedActivation.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setModalError("Could not copy. Share the code manually.");
    }
  };

  const revokeRegistration = async (registrationId) => {
    if (busyAction) return;
    setBusyAction(`revoke-${registrationId}`);
    setError("");
    setSuccess("");
    try {
      await apiClient.post(`/admin/devices/${registrationId}/revoke`);
      setSuccess("Registration revoked. The trainer can activate a new device with a fresh code.");
      await fetchData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to revoke registration.");
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return <div className="page-content"><p className="muted-copy">Loading device management...</p></div>;
  }

  const activeRegistrations = registrations.filter((r) => r.active);

  return (
    <div className="page-content">
      <PageHeader
        title="Trainer Attendance Devices"
        description="Generate one-time activation codes for trainers. The trainer redeems the code on the device they want to use for customer attendance."
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      <SectionHeader title="Active Devices" sub="Trainers currently running customer attendance." />
      {activeRegistrations.length === 0 ? (
        <EmptyState title="No active devices" description="Generate an activation code below and share it with the trainer." />
      ) : (
        <div className="admin-device-grid">
          {activeRegistrations.map((r) => (
            <div key={r.registrationId} className="admin-device-card device-active">
              <div className="admin-device-info">
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                  {r.trainerName || "Trainer"}
                </h3>
                <StatusBadge label="Active" cls="badge-active" />
                <InfoRow label="Scope" value={scopeLabel(r.scope)} />
                <InfoRow label="Activated" value={fmt(r.activatedAt)} />
              </div>
              <div className="device-card-actions">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busyAction === `revoke-${r.registrationId}`}
                  onClick={() => revokeRegistration(r.registrationId)}
                >
                  {busyAction === `revoke-${r.registrationId}` ? "Revoking..." : "Revoke Device"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionHeader title="Trainers" sub="Select a trainer to generate a one-time activation." style={{ marginTop: 24 }} />
      {trainers.length === 0 ? (
        <EmptyState title="No trainers" description="Create a trainer account first." />
      ) : (
        <div className="admin-device-grid">
          {trainers.map((t) => {
            const trainerActive = activeRegistrations.find(
              (r) => String(r.trainerId) === String(t._id)
            );
            return (
              <div key={t._id} className="admin-device-card">
                <div className="admin-device-info">
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t.fullName || t.username}</h3>
                  <InfoRow label="Scope" value={scopeLabel(t.scope)} />
                  <InfoRow label="Status" value={t.status === "active" ? "Active" : t.status || "—"} />
                  {trainerActive ? (
                    <StatusBadge label="Device active" cls="badge-active" />
                  ) : (
                    <StatusBadge label="No active device" cls="badge-muted" />
                  )}
                </div>
                <div className="device-card-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => openActivationModal(t)}
                    disabled={!t.status || t.status !== "active"}
                  >
                    Generate Activation
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalTrainer ? (
        <div className="modal-shell" onClick={closeActivationModal}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Generate Attendance Activation</h2>
                <p className="muted-copy" style={{ margin: "2px 0 0", fontSize: 13 }}>
                  Trainer: {modalTrainer.fullName || modalTrainer.username} · Scope: {scopeLabel(modalTrainer.scope)}
                </p>
              </div>
              <button type="button" className="icon-close-btn" onClick={closeActivationModal} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal-content">
              {modalError ? <div className="modal-error">{modalError}</div> : null}

              {!issuedActivation ? (
                <div style={{ textAlign: "center", padding: "8px 0" }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>One-Time Activation</h3>
                  <p className="muted-copy" style={{ margin: "8px auto 16px", fontSize: 13, maxWidth: 360 }}>
                    Generate a one-time activation for this trainer. The trainer will
                    use the code on the device they want to use for attendance. The
                    code expires quickly and can only be used once.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={modalLoading}
                    onClick={generateActivation}
                  >
                    {modalLoading ? "Generating..." : "Generate Code"}
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: "center" }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Share this code with the trainer</h3>
                  <div
                    style={{
                      fontSize: 36,
                      fontWeight: 800,
                      letterSpacing: "0.18em",
                      margin: "16px 0",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    {issuedActivation.code}
                  </div>
                  <p>
                    <span className="admin-device-badge badge-pending">
                      {fmtCountdown(issuedActivation.expiresAt)}
                    </span>
                  </p>
                  {issuedActivation.qrPayload ? (
                    <div className="qr-box" style={{ display: "flex", justifyContent: "center" }}>
                      <QRCodeSVG value={String(issuedActivation.qrPayload)} size={180} level="M" />
                    </div>
                  ) : null}
                  <p className="muted-copy" style={{ fontSize: 11, margin: "10px 0 0" }}>
                    The trainer logs in on their chosen device and enters this code
                    (or scans the QR) to activate attendance.
                  </p>
                  <div className="modal-button-row">
                    <button type="button" className="btn btn-outline btn-sm" onClick={closeActivationModal}>
                      Done
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={copyCode}>
                      {copied ? "Copied!" : "Copy Code"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}