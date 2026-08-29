import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiMessageCircle, FiX, FiPlus } from "react-icons/fi";
import { useLocation } from "react-router-dom";
import apiClient from "../../../utils/apiClient.js";
import ChatWindow from "./ChatWindow.jsx";
import { useAdmin } from "../../authContext.js";
import "../../styles/AiAssistant.css";

// Route → informational module context sent to the backend. This is UI-only
// context; the backend never treats it as an authorization mechanism.
const MODULE_PATHS = {
  "/admin": "dashboard",
  "/admin/members": "all_members",
  "/admin/attendance-front-desk": "attendance",
  "/admin/inactivity-reports": "inactivity_reports",
  "/admin/enquiries": "customer_enquiries",
};

const ALLOWED_PATHS = Object.keys(MODULE_PATHS);

// Persist the current chat session per admin so closing/reopening the widget
// (and navigating between supported modules) never destroys the conversation.
const sessionKeyFor = (adminId) => `gym_ai_session_${adminId}`;

const createMessage = (role, content, type = "text", data = null) => ({
  id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role,
  content,
  type,
  data,
  timestamp: new Date().toISOString(),
});

export const FloatingAIAssistant = () => {
  const admin = useAdmin();
  const location = useLocation();
  const isSuperAdmin = admin?.role === "superadmin";
  const currentModule = MODULE_PATHS[location.pathname] || null;
  const shouldRender = isSuperAdmin && ALLOWED_PATHS.includes(location.pathname);

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const inputRef = useRef(null);
  const adminIdRef = useRef(admin?.id);

  // Reset the widget when the logged-in admin changes.
  useEffect(() => {
    if (adminIdRef.current !== admin?.id) {
      adminIdRef.current = admin?.id;
      const stored = admin?.id ? window.sessionStorage.getItem(sessionKeyFor(admin.id)) : null;
      setSessionId(stored || null);
      setMessages([]);
      setHistoryLoaded(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin?.id]);

  // Restore session id from sessionStorage when the widget becomes available.
  useEffect(() => {
    if (!shouldRender) return;
    if (admin?.id && !sessionId) {
      const stored = window.sessionStorage.getItem(sessionKeyFor(admin.id));
      if (stored) setSessionId(stored);
    }
  }, [shouldRender, admin?.id, sessionId]);

  // Focus the input whenever the panel opens.
  useEffect(() => {
    if (isOpen) inputRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && isOpen) setIsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  const loadHistory = useCallback(
    async (sid) => {
      try {
        const { data } = await apiClient.get(`/ai/sessions/${encodeURIComponent(sid)}`);
        const history = data?.data?.history || [];
        if (history.length === 0) {
          setMessages([
            createMessage(
              "assistant",
              "Hi! I'm Giri Gym Assistant. Ask me about members, expirations, attendance, inactivity, or enquiries."
            ),
          ]);
          return;
        }
        const restored = history.map((msg) =>
          createMessage(msg.role, msg.content, msg.messageType || "text", msg.data || null)
        );
        setMessages(restored);
      } catch {
        // Session no longer valid — start a fresh conversation.
        if (admin?.id) window.sessionStorage.removeItem(sessionKeyFor(admin.id));
        setSessionId(null);
        setMessages([
          createMessage(
            "assistant",
            "Hi! I'm Giri Gym Assistant. Ask me about members, expirations, attendance, inactivity, or enquiries."
          ),
        ]);
      }
    },
    [admin?.id]
  );

  // Load the existing conversation when the panel opens.
  useEffect(() => {
    if (!isOpen || !shouldRender) return;
    if (!historyLoaded) {
      if (sessionId) {
        loadHistory(sessionId);
      } else {
        setMessages([
          createMessage(
            "assistant",
            "Hi! I'm Giri Gym Assistant. Ask me about members, expirations, attendance, inactivity, or enquiries."
          ),
        ]);
      }
      setHistoryLoaded(true);
    }
  }, [isOpen, shouldRender, historyLoaded, sessionId, loadHistory]);

  const persistSession = useCallback(
    (sid) => {
      setSessionId(sid);
      if (admin?.id) window.sessionStorage.setItem(sessionKeyFor(admin.id), sid);
    },
    [admin?.id]
  );

  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isLoading) return;

    setError(null);
    const userMessage = createMessage("user", trimmed);
    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);

    try {
      const { data } = await apiClient.post(
        "/ai/chat",
        {
          message: trimmed,
          sessionId: sessionId || undefined,
          currentModule,
        }
      );

      const newSessionId = data?.sessionId;
      if (newSessionId) persistSession(newSessionId);

      const response = data?.response || {};
      const messageType = response.data ? "data" : "text";
      setMessages((prev) => [
        ...prev,
        createMessage("assistant", response.text || "Done.", messageType, response.data || null),
      ]);
    } catch (requestError) {
      if (requestError.response?.status === 429) {
        setError("You're sending requests too quickly. Please try again shortly.");
      } else if (requestError.response?.status === 500 || requestError.response?.status === 502) {
        setError("The assistant is temporarily unavailable. Please try again in a moment.");
      } else {
        setError(
          requestError.response?.data?.message || "Something went wrong. Please try again."
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    if (admin?.id) window.sessionStorage.removeItem(sessionKeyFor(admin.id));
    setSessionId(null);
    setMessages([
      createMessage(
        "assistant",
        "Hi! I'm Giri Gym Assistant. Ask me about members, expirations, attendance, inactivity, or enquiries."
      ),
    ]);
    setError(null);
    setHistoryLoaded(true);
    inputRef.current?.focus({ preventScroll: true });
  };

  if (!shouldRender) return null;

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          className="ai-launcher"
          onClick={() => setIsOpen(true)}
          aria-label="Open AI Assistant"
          title="Giri Gym Assistant"
        >
          <FiMessageCircle size={24} strokeWidth={2} />
        </button>
      )}

      {isOpen && (
        <div className="ai-widget" role="dialog" aria-label="Giri Gym Assistant">
          <div className="ai-widget-header">
            <div className="ai-widget-title-wrap">
              <span className="ai-widget-title">Giri Gym Assistant</span>
              <span className="ai-widget-status">
                <span className="ai-widget-dot" aria-hidden="true" />
                Online
              </span>
            </div>
            <div className="ai-widget-actions">
              <button
                type="button"
                className="ai-widget-icon-btn"
                onClick={handleNewChat}
                aria-label="Start new chat"
                title="New chat"
              >
                <FiPlus size={18} />
              </button>
              <button
                type="button"
                className="ai-widget-icon-btn"
                onClick={() => setIsOpen(false)}
                aria-label="Close AI Assistant"
                title="Close"
              >
                <FiX size={18} />
              </button>
            </div>
          </div>

          <ChatWindow messages={messages} />

          <div className="ai-composer">
            <input
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask about members, expirations, attendance…"
              aria-label="Message Giri Gym Assistant"
              disabled={isLoading}
            />
            <button
              type="button"
              className="ai-composer-send"
              onClick={handleSend}
              disabled={isLoading || !inputText.trim()}
              aria-label="Send message"
            >
              {isLoading ? "…" : "Send"}
            </button>
          </div>

          {error && <div className="ai-error">{error}</div>}
        </div>
      )}
    </>
  );
};

export default FloatingAIAssistant;