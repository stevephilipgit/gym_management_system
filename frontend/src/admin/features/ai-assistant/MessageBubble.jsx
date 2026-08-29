import ReminderTable from "./ReminderTable.jsx";

const formatTime = (timestamp) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

const IGNORED_KEYS = ["members", "results"];

const prettyLabel = (key) =>
  key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());

const renderDataSummary = (data) => {
  const entries = Object.entries(data || {}).filter(([key, value]) => {
    if (IGNORED_KEYS.includes(key)) return false;
    return value !== null && typeof value !== "object";
  });

  if (entries.length === 0) return null;

  return (
    <div>
      {entries.map(([key, value]) => (
        <div key={key} className="ai-summary-line">
          <span className="ai-summary-key">{prettyLabel(key)}</span>
          <span className="ai-summary-val">{String(value)}</span>
        </div>
      ))}
    </div>
  );
};

export const MessageBubble = ({ message }) => {
  const bubbleClass =
    message.role === "user" ? "ai-bubble-base ai-bubble-user" : "ai-bubble-base ai-bubble-assistant";

  return (
    <div className="ai-message-block">
      <div className={bubbleClass}>
        <div>{message.content}</div>

        {message.type === "data" && message.data && (
          <div className="ai-summary">
            {Array.isArray(message.data.members) && message.data.members.length > 0 ? (
              <ReminderTable members={message.data.members} />
            ) : (
              renderDataSummary(message.data)
            )}
          </div>
        )}
      </div>
      <div className="ai-timestamp">{formatTime(message.timestamp)}</div>
    </div>
  );
};

export default MessageBubble;