import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble.jsx";

export const ChatWindow = ({ messages, children }) => {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="ai-chat-window">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {children}
      <div ref={bottomRef} />
    </div>
  );
};

export default ChatWindow;