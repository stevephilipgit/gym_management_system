// admin/components/ui/DeviceComponents.jsx - Reusable UI primitives for device/attendance pages
//
// Lightweight, semantic, reusable primitives. No new state management, no new
// styling framework — just clean HTML + existing CSS classes.

/**
 * Page-level heading with optional description and optional right-side actions.
 * Usage: <PageHeader title="Device Management" description="..." actions={<button .../>} />
 * When `actions` is provided the header becomes a wrapping flex row with the
 * action slot at the top-right (wraps below the title on narrow widths).
 */
export function PageHeader({ title, description, actions }) {
  if (actions) {
    return (
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px 16px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title" style={{ margin: 0, fontSize: 22 }}>{title}</h1>
          {description ? <p className="muted-copy" style={{ margin: "4px 0 0" }}>{description}</p> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>{actions}</div>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 className="page-title" style={{ margin: 0, fontSize: 22 }}>{title}</h1>
      {description ? <p className="muted-copy" style={{ margin: "4px 0 0" }}>{description}</p> : null}
    </div>
  );
}

/**
 * Major section heading.
 * Usage: <SectionHeader title="Physical Devices" />
 */
export function SectionHeader({ title, sub, style: extStyle }) {
  return (
    <div style={{ marginBottom: 12, ...extStyle }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
      {sub ? <p className="muted-copy" style={{ margin: "2px 0 0", fontSize: 13 }}>{sub}</p> : null}
    </div>
  );
}

/**
 * Status badge. Uses the existing CSS badge classes.
 * @param {*} label
 * @param {*} cls — one of "badge-active", "badge-pending", "badge-rejected", "badge-muted"
 */
export function StatusBadge({ label, cls }) {
  return <span className={`admin-device-badge ${cls || "badge-muted"}`}>{label || "—"}</span>;
}

/**
 * Consistent empty state for sections with no content.
 */
export function EmptyState({ title, description, children }) {
  return (
    <div className="empty-state" style={{ minHeight: 140, padding: 24, marginBottom: 16 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>{title}</h3>
      {description ? <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>{description}</p> : null}
      {children}
    </div>
  );
}

/**
 * Info row used inside cards for Kiosk metadata.
 */
export function InfoRow({ label, value }) {
  return (
    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
      {label}: {value || "—"}
    </span>
  );
}