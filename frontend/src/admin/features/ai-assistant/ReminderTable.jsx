const DAY_MS = 1000 * 60 * 60 * 24;

const getDaysLeft = (validTill) => {
  if (!validTill) return null;
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

export const ReminderTable = ({ members = [] }) => {
  if (!Array.isArray(members) || members.length === 0) {
    return <div className="ai-empty">No members to display.</div>;
  }

  const visibleMembers = members.slice(0, 10);
  const remaining = members.length - visibleMembers.length;
  const showExpiry = visibleMembers.some((m) => m.validTill);
  const showLastAttendance = visibleMembers.some((m) => m.lastAttendance);

  return (
    <div className="ai-reminder-table-wrapper">
      <table className="ai-reminder-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            {showExpiry && <th>Expiry Date</th>}
            {showExpiry && <th>Days Left</th>}
            {showLastAttendance && <th>Last Attendance</th>}
          </tr>
        </thead>
        <tbody>
          {visibleMembers.map((member, index) => (
            <tr key={`${member.phone || member.name}-${index}`}>
              <td>{member.name || "-"}</td>
              <td>{member.phone || "-"}</td>
              {showExpiry && <td>{formatDate(member.validTill)}</td>}
              {showExpiry && <td>{getDaysLeft(member.validTill) ?? "-"}</td>}
              {showLastAttendance && <td>{formatDate(member.lastAttendance)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {remaining > 0 && <div className="ai-more">...and {remaining} more</div>}
    </div>
  );
};

export default ReminderTable;