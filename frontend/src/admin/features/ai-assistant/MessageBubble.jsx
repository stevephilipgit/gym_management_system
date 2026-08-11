import ReminderTable from "./ReminderTable.jsx";

const formatTime = (timestamp) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export const MessageBubble = ({ message, onConfirm }) => {
  const bubbleClass =
    message.role === "user" ? "ai-bubble-base ai-bubble-user" : "ai-bubble-base ai-bubble-assistant";

  return (
    <div className="ai-message-block">
      <div className={bubbleClass}>
        <div>{message.content}</div>

        {message.type === "data" && message.data && (
          <div className="ai-summary">
            {typeof message.data.count === "number" && <div>Found {message.data.count} record(s).</div>}
            {Array.isArray(message.data.members) && <ReminderTable members={message.data.members} />}
          </div>
        )}

        {message.type === "confirmation" && (
          <>
            <div className="ai-summary">
              <ReminderTable members={message.data?.members || []} showConfirm={true} showWhatsApp={false} />
            </div>
            <div className="ai-confirm-actions">
              <button type="button" className="ai-confirm-btn" onClick={() => onConfirm("confirm")}>
                Confirm & Prepare
              </button>
              <button type="button" className="ai-cancel-btn" onClick={() => onConfirm("cancel")}>
                Cancel
              </button>
            </div>
          </>
        )}

        {message.type === "reminders" && (
          <div className="ai-summary">
            <ReminderTable members={message.data?.reminders || []} showWhatsApp />
          </div>
        )}
      </div>
      <div className="ai-timestamp">{formatTime(message.timestamp)}</div>
    </div>
  );
};

export default MessageBubble;
