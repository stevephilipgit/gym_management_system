import { useCallback, useEffect, useRef, useState } from "react";
import { FiMessageCircle, FiX, FiPlus, FiTrash2 } from "react-icons/fi";
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

const WELCOME_TEXT =
  "Hi! I'm Giri Gym Assistant. Ask me about members, expirations, attendance, inactivity, or enquiries — or tap a suggestion below.";

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
  const [capabilities, setCapabilities] = useState([]);
  const [memory, setMemory] = useState(null); // null = not loaded
  const [showMemory, setShowMemory] = useState(false);

  const inputRef = useRef(null);
  const adminIdRef = useRef(admin?.id);
  const abortRef = useRef(null);

  // ── Admin change → full reset ──────────────────────────────
  useEffect(() => {
    if (adminIdRef.current !== admin?.id) {
      adminIdRef.current = admin?.id;
      const stored = admin?.id ? window.sessionStorage.getItem(sessionKeyFor(admin.id)) : null;
      setSessionId(stored || null);
      setMessages([]);
      setHistoryLoaded(false);
      setError(null);
      setCapabilities([]);
      setMemory(null);
      setShowMemory(false);
    }
  }, [admin?.id]);

  // ── Load the canonical capability catalog (module-contextual) ──
  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    apiClient
      .get("/ai/capabilities", { params: { module: currentModule || undefined } })
      .then(({ data }) => {
        if (!cancelled) setCapabilities(data?.data || []);
      })
      .catch(() => {
        // Capability display is informational; failure is non-fatal.
      });
    return () => {
      cancelled = true;
    };
  }, [shouldRender, currentModule]);

  // ── Restore session id from sessionStorage ─────────────────
  useEffect(() => {
    if (!shouldRender) return;
    if (admin?.id && !sessionId) {
      const stored = window.sessionStorage.getItem(sessionKeyFor(admin.id));
      if (stored) setSessionId(stored);
    }
  }, [shouldRender, admin?.id, sessionId]);

  // Focus input whenever panel opens.
  useEffect(() => {
    if (isOpen) inputRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  // Escape closes the panel (and aborts an in-flight request).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && isOpen) {
        abortRef.current?.abort();
        setIsLoading(false);
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // ── Cleanup on unmount: abort in-flight request, no state leaks ──
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const loadHistory = useCallback(
    async (sid) => {
      try {
        const { data } = await apiClient.get(`/ai/sessions/${encodeURIComponent(sid)}`);
        const history = data?.data?.history || [];
        if (history.length === 0) {
          setMessages([createMessage("assistant", WELCOME_TEXT)]);
          return;
        }
        const restored = history.map((msg) =>
          createMessage(msg.role, msg.content, msg.messageType || "text", msg.data || null)
        );
        setMessages(restored);
      } catch (requestError) {
        // 404 = session gone/expired → safe to start fresh.
        // Other errors → show an error, don't silently fork history.
        if (requestError.response?.status === 404) {
          if (admin?.id) window.sessionStorage.removeItem(sessionKeyFor(admin.id));
          setSessionId(null);
          setMessages([createMessage("assistant", WELCOME_TEXT)]);
        } else {
          setError("Couldn't restore the conversation. Please try again.");
        }
      }
    },
    [admin?.id]
  );

  // Load the existing conversation when the panel opens (only once per session).
  useEffect(() => {
    if (!isOpen || !shouldRender) return;
    if (!historyLoaded) {
      if (sessionId) {
        loadHistory(sessionId);
      } else {
        setMessages([createMessage("assistant", WELCOME_TEXT)]);
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

  const handleSend = async (textOverride) => {
    const trimmed = (textOverride ?? inputText).trim();
    if (!trimmed || isLoading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setShowMemory(false);
    const userMessage = createMessage("user", trimmed);
    setMessages((prev) => [...prev, userMessage]);
    if (!textOverride) setInputText("");
    setIsLoading(true);

    try {
      const { data } = await apiClient.post(
        "/ai/chat",
        {
          message: trimmed,
          sessionId: sessionId || undefined,
          currentModule,
        },
        { signal: controller.signal }
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
      if (requestError.code === "ERR_CANCELED") return; // user closed/navigated away
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
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const handleCapabilityClick = (capability) => {
    // Clickable capability → normal chat pipeline via an example prompt.
    const prompt = capability?.examplePrompts?.[0] || capability?.displayName;
    if (prompt) handleSend(prompt);
  };

  // ── New Chat: archive the current session, then reset transient state ──
  const handleNewChat = async () => {
    if (sessionId && admin?.id) {
      try {
        await apiClient.post(`/ai/sessions/${encodeURIComponent(sessionId)}/archive`);
      } catch {
        // Non-fatal: archiving is best-effort; history remains retrievable.
      }
    }
    if (admin?.id) window.sessionStorage.removeItem(sessionKeyFor(admin.id));
    setSessionId(null);
    setMessages([createMessage("assistant", WELCOME_TEXT)]);
    setError(null);
    setHistoryLoaded(true);
    setShowMemory(false);
    inputRef.current?.focus({ preventScroll: true });
  };

  // ── Close: release transient UI state, keep persisted conversation ──
  const handleClose = () => {
    abortRef.current?.abort();
    setIsLoading(false);
    setError(null);
    setShowMemory(false);
    setIsOpen(false);
  };

  // ── Memory management (explicit, owner-scoped, separate from close) ──
  const toggleMemory = async () => {
    if (!showMemory) {
      try {
        const { data } = await apiClient.get("/ai/memory");
        setMemory(data?.data || []);
      } catch {
        setMemory([]);
      }
    }
    setShowMemory((prev) => !prev);
  };

  const handleClearMemory = async () => {
    if (!window.confirm("Clear all of your saved AI memory? This cannot be undone.")) return;
    try {
      await apiClient.delete("/ai/memory");
      setMemory([]);
    } catch {
      setError("Couldn't clear memory. Please try again.");
    }
  };

  if (!shouldRender) return null;

  const showSuggestions = messages.length === 0;

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
                onClick={toggleMemory}
                aria-label="Memory"
                title="View / clear AI memory"
              >
                <FiTrash2 size={18} />
              </button>
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
                onClick={handleClose}
                aria-label="Close AI Assistant"
                title="Close"
              >
                <FiX size={18} />
              </button>
            </div>
          </div>

          {showMemory ? (
            <div className="ai-memory-panel">
              <div className="ai-memory-header">
                <span>Saved memory ({memory?.length || 0})</span>
                <button
                  type="button"
                  className="ai-memory-clear"
                  onClick={handleClearMemory}
                  disabled={!memory || memory.length === 0}
                >
                  Clear all
                </button>
              </div>
              {!memory || memory.length === 0 ? (
                <div className="ai-memory-empty">No saved memory.</div>
              ) : (
                <ul className="ai-memory-list">
                  {memory.map((item) => (
                    <li key={item.key} className="ai-memory-item">
                      <span className="ai-memory-key">{item.key}</span>
                      <span className="ai-memory-value">
                        {typeof item.value === "string"
                          ? item.value
                          : JSON.stringify(item.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <ChatWindow messages={messages}>
                {showSuggestions && capabilities.length > 0 && (
                  <div className="ai-suggestions">
                    <span className="ai-suggestions-label">What can I help with?</span>
                    <div className="ai-suggestions-grid">
                      {capabilities.map((capability) => (
                        <button
                          key={capability.id}
                          type="button"
                          className="ai-suggestion-chip"
                          onClick={() => handleCapabilityClick(capability)}
                          disabled={isLoading}
                        >
                          <span className="ai-suggestion-title">{capability.displayName}</span>
                          <span className="ai-suggestion-desc">{capability.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </ChatWindow>

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
                  onClick={() => handleSend()}
                  disabled={isLoading || !inputText.trim()}
                  aria-label="Send message"
                >
                  {isLoading ? "…" : "Send"}
                </button>
              </div>
            </>
          )}

          {error && <div className="ai-error">{error}</div>}
        </div>
      )}
    </>
  );
};

export default FloatingAIAssistant;