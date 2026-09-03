import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";

import apiClient from "../utils/apiClient.js";
import IconButton from "./components/ui/IconButton.jsx";
import {
  PageHeader,
  StatusBadge,
  EmptyState,
} from "./components/ui/DeviceComponents.jsx";

function scopeLabel(scope) {
  return scope === "male"
    ? "Male"
    : scope === "female_plus_transgender"
    ? "Female + Transgender"
    : scope || "—";
}

function shortDeviceId(id) {
  if (!id) return "—";
  if (id.length <= 18) return id;
  return `${id.slice(0, 10)}…${id.slice(-4)}`;
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

/**
 * State-aware action menu for a trainer row.
 * No device → [Activate]
 * Has device → [Replace device] [Revoke device]
 */
function DeviceDeviceMenu({ trainer, activeRegistration, onActivate, onRevoke, busy }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const hasDevice = !!activeRegistration;

  const toggle = () => {
    if (!open && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 140) });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <span ref={wrapRef} style={{ display: "inline-flex" }}>
        <IconButton
          type="more"
          title="Device actions"
          ariaLabel={`Device actions for ${trainer.fullName || trainer.username}`}
          ariaExpanded={open}
          onClick={toggle}
        />
      </span>
      {open
        ? createPortal(
            <>
              <div className="device-overflow-backdrop" onClick={() => setOpen(false)} />
              <div
                className="device-overflow-menu"
                role="menu"
                aria-label={`Device actions for ${trainer.fullName || trainer.username}`}
                style={{ position: "fixed", top: pos.top, left: pos.left }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="device-overflow-item"
                  onClick={() => { setOpen(false); onActivate(trainer); }}
                >
                  {hasDevice ? "Replace device" : "Activate"}
                </button>
                {hasDevice ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="device-overflow-item device-overflow-item-danger"
                    disabled={busy}
                    onClick={() => { setOpen(false); onRevoke(activeRegistration.registrationId); }}
                  >
                    {busy ? "Revoking…" : "Revoke device"}
                  </button>
                ) : null}
              </div>
            </>,
            document.body
          )
        : null}
    </>
  );
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

  const getTrainerActive = (trainerId) =>
    activeRegistrations.find((r) => String(r.trainerId) === String(trainerId));

  return (
    <div className="page-content">
      <PageHeader
        title="Trainer Attendance Devices"
        description="Manage trainer attendance devices and activation access."
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}
      {trainers.length === 0 ? (
        <EmptyState title="No trainers" description="Create a trainer account first." />
      ) : (
        <>
          {/* Desktop / tablet — compact table */}
          <div className="saas-table-container device-table">
            <table className="saas-table">
              <thead>
                <tr>
                  <th scope="col">Trainer</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Status</th>
                  <th scope="col">Device</th>
                  <th className="device-col-actions" scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {trainers.map((t) => {
                  const trainerActive = getTrainerActive(t._id);
                  return (
                    <tr key={t._id}>
                      <td className="pk-name">{t.fullName || t.username}</td>
                      <td className="device-col-scope">{scopeLabel(t.scope)}</td>
                      <td>
                        {t.status === "active" ? (
                          <StatusBadge label="Active" cls="badge-active" />
                        ) : (
                          <StatusBadge label={t.status || "—"} cls="badge-muted" />
                        )}
                      </td>
                      <td className="device-col-device" title={trainerActive?.browserDeviceId || ""}>
                        {trainerActive
                          ? trainerActive.deviceLabel || shortDeviceId(trainerActive.browserDeviceId)
                          : <span className="device-col-none">No device</span>}
                      </td>
                      <td className="device-col-actions">
                        <DeviceDeviceMenu
                          trainer={t}
                          activeRegistration={trainerActive}
                          onActivate={openActivationModal}
                          onRevoke={revokeRegistration}
                          busy={trainerActive ? busyAction === `revoke-${trainerActive.registrationId}` : false}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile — compact stacked rows */}
          <div className="device-stack">
            {trainers.map((t) => {
              const trainerActive = getTrainerActive(t._id);
              return (
                <div key={t._id} className="device-stack-row">
                  <div className="device-stack-top">
                    <span className="device-stack-name">{t.fullName || t.username}</span>
                    {t.status === "active" ? (
                      <StatusBadge label="Active" cls="badge-active" />
                    ) : (
                      <StatusBadge label={t.status || "—"} cls="badge-muted" />
                    )}
                  </div>
                  <div className="device-stack-meta">
                    {scopeLabel(t.scope)} · {trainerActive
                      ? trainerActive.deviceLabel || shortDeviceId(trainerActive.browserDeviceId)
                      : "No device"}
                  </div>
                  <div className="device-stack-actions">
                    <DeviceDeviceMenu
                      trainer={t}
                      activeRegistration={trainerActive}
                      onActivate={openActivationModal}
                      onRevoke={revokeRegistration}
                      busy={trainerActive ? busyAction === `revoke-${trainerActive.registrationId}` : false}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
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