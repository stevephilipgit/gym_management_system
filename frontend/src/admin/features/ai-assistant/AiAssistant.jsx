import { useEffect, useMemo, useState } from "react";
import apiClient from "../../../utils/apiClient.js";
import ChatWindow from "./ChatWindow.jsx";
import "../../styles/AiAssistant.css";

const createMessage = (role, content, type = "text", data = null) => ({
  id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role,
  content,
  type,
  data,
  timestamp: new Date().toISOString(),
});

export const AiAssistant = () => {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingToken, setPendingToken] = useState(null);
  const [error, setError] = useState(null);
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    setMessages([
      createMessage(
        "assistant",
        "Hi! I'm your gym assistant. Ask me about members, expirations, or reminders."
      ),
    ]);
  }, []);

  const appendMessage = (message) => {
    setMessages((prev) => [...prev, message]);
  };

  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isLoading) {
      return;
    }

    setError(null);
    appendMessage(createMessage("user", trimmed));
    setInputText("");
    setIsLoading(true);

    try {
      const { data } = await apiClient.post(
        "/ai/chat",
        { message: trimmed, sessionId },
        {
          headers: {
            "x-session-id": sessionId,
          },
        }
      );

      const payload = data.response;
      if (payload.requiresConfirmation === true) {
        setPendingToken(payload.confirmationToken);
        appendMessage({
          role: "assistant",
          type: "confirmation",
          content: payload.text,
          data: payload.previewData,
          timestamp: new Date().toISOString(),
          id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
        return;
      }

      const messageType = payload.data?.reminders
        ? "reminders"
        : payload.data
          ? "data"
          : "text";
      setPendingToken(null);
      appendMessage(createMessage("assistant", payload.text, messageType, payload.data));
    } catch (requestError) {
      if (requestError.response?.status === 429) {
        setError("You're sending too many messages. Please wait.");
      } else if (requestError.response?.status === 500) {
        setError("Something went wrong. Please try again.");
      } else {
        setError(requestError.response?.data?.message || requestError.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async (action) => {
    if (!pendingToken) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data } = await apiClient.post(
        "/ai/confirm",
        { token: pendingToken, action },
        {
          headers: {
            "x-session-id": sessionId,
          },
        }
      );

      if (data.response?.data?.reminders) {
        appendMessage({
          role: "assistant",
          type: "reminders",
          content: "Reminders prepared. Use the WhatsApp buttons below to send.",
          data: data.response.data,
          timestamp: new Date().toISOString(),
          id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
      } else {
        appendMessage({
          role: "assistant",
          type: "text",
          content: data.response.text,
          data: null,
          timestamp: new Date().toISOString(),
          id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setPendingToken(null);
      setIsLoading(false);
    }
  };

  return (
    <div className="ai-assistant-panel">
      <ChatWindow messages={messages} onConfirm={handleConfirm} />
      <div className="ai-input-row">
        <input
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              handleSend();
            }
          }}
          placeholder="Ask about members, expirations, or reminders"
        />
        <button type="button" onClick={handleSend} disabled={isLoading}>
          {isLoading ? "..." : "Send"}
        </button>
      </div>
      {error && <div className="ai-error">{error}</div>}
    </div>
  );
};

export default AiAssistant;
