const DAY_MS = 1000 * 60 * 60 * 24;

const getDaysLeft = (validTill) => {
  if (!validTill) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const valid = new Date(validTill);
  valid.setHours(0, 0, 0, 0);

  return Math.ceil((valid.getTime() - today.getTime()) / DAY_MS);
};

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB");
};

export const ReminderTable = ({ members = [], showConfirm = false, showWhatsApp = false }) => {
  if (!Array.isArray(members) || members.length === 0) {
    return <div className="ai-empty">No members to display.</div>;
  }

  const visibleMembers = members.slice(0, 10);
  const remaining = members.length - visibleMembers.length;

  return (
    <div>
      <table className="ai-reminder-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Expiry Date</th>
            <th>Days Left</th>
            {showWhatsApp && <th>Message preview</th>}
            {showWhatsApp && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {visibleMembers.map((member, index) => (
            <tr key={`${member.phone || member.name}-${index}`}>
              <td>{member.name || "-"}</td>
              <td>{member.phone || "-"}</td>
              <td>{formatDate(member.validTill)}</td>
              <td>{getDaysLeft(member.validTill)}</td>
              {showWhatsApp && (
                <td>
                  {`${String(member.message || "").slice(0, 60)}${
                    String(member.message || "").length > 60 ? "..." : ""
                  }`}
                </td>
              )}
              {showWhatsApp && (
                <td>
                  <button
                    type="button"
                    className="ai-whatsapp-btn"
                    onClick={() => window.open(member.whatsappLink, "_blank", "noopener,noreferrer")}
                  >
                    📱 Send via WhatsApp
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {showConfirm ? null : null}
      {remaining > 0 && <div className="ai-more">...and {remaining} more</div>}
    </div>
  );
};

export default ReminderTable;
