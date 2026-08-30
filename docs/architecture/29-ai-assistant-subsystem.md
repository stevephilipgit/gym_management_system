# 29 — AI Assistant Subsystem (Floating Chat)

> Live document describing the **current** implementation on branch
> `feat/ai-floating-assistant`. Supersedes the architecture described in
> `15-ai.md` (the old full-page Gemini chat with in-memory stores), which has
> been replaced by this subsystem.

---

## 1. Feature Overview

Giri Gym Assistant is an isolated, production-oriented AI subsystem available
**only to Super Admins**. It is a single global floating chat widget that
overlays the admin UI on a fixed allow-list of modules.

- **What it does:** answers natural-language questions about gym data
  (members, expirations, attendance, inactivity, enquiries) using an LLM with
  a controlled, whitelisted tool-calling layer.
- **How it works:** the LLM never touches MongoDB directly. It emits a
  structured tool call (`{"tool": "...", "params": {...}}` or
  `{"steps": [...]}`); the backend validates it against a tool registry and
  executes the corresponding data-access function with the authenticated
  admin's scope enforced.
- **Not a chatbot platform:** no Intercom/Tidio/Botpress/Dialogflow, no
  iframes, no new UI framework, no new UI dependencies.

### Where it appears

| Module | Route | Module context sent to AI |
|---|---|---|
| Dashboard | `/admin` | `dashboard` |
| All Members | `/admin/members` | `all_members` |
| Daily Attendance | `/admin/attendance-front-desk` | `attendance` |
| Inactivity Reports | `/admin/inactivity-reports` | `inactivity_reports` |
| Customer Enquiries | `/admin/enquiries` | `customer_enquiries` |

### Where it does NOT appear

Register Member, Update Member, Packages, Diet Manager, Form Fields, Manage
Accounts, Settings, the public site, Login, and every non-super-admin session.

---

## 2. End-to-End Picture (single message round trip)

```
Super Admin types a message
   │
   ▼
FloatingAIAssistant.jsx (frontend, mounted in AdminLayout)
   │  POST /api/ai/chat  { message, sessionId?, currentModule }
   │  (apiClient adds X-Session-Id header + session-scoped cookie)
   ▼
server.js  →  app.use("/api/ai", adminAuth, requireRole("superadmin"), aiRoutes)
   │
   ▼
middleware/adminAuth.js
   │  verifies JWT + X-Session-Id header + AdminSession document
   │  attaches req.admin = { id, username, role, scope }
   ▼
middleware/requireRole.js  →  role !== "superadmin" → 403
   │
   ▼
routes/aiRoutes.js  →  POST /chat → aiPerHourLimiter → aiPerMinuteLimiter
   │  (rate limit keyed by req.admin.id)
   ▼
controllers/aiController.js  →  handleChat
   │
   ▼
services/ai/chatService.js  →  processMessage({ message, sessionId, currentModule, admin })
   │
   ├─ 1. Validate message (empty / length / strip HTML)          → 400
   ├─ 2. Resolve or create ChatSession (ownership-checked)        → 404 if forged
   ├─ 3. Update session metadata.currentModule (informational only)
   ├─ 4. Prompt-injection regex check                             → blocked reply
   ├─ 5. Build adminContext { scope }  (from authenticated admin)
   ├─ 6. Load bounded history  (last N pairs, ownership-checked)
   ├─ 7. Load admin memory       (AIUserMemory, ownership-checked)
   ├─ 8. buildSystemPrompt(module, memory)   → system prompt + tools list
   ├─ 9. generateWithFallback(...)           → provider chain
   │       primary provider → success? → return
   │       retryable failure → fallback provider → return
   │       both fail → rule-based fallback reply
   ├─10. Parse model output (JSON tool call vs plain text)
   ├─11. Execute validated tools via toolExecutor (scope enforced)
   ├─12. Persist user + assistant ChatMessage documents
   └─13. Return { sessionId, response: { text, data, source } }
   │
   ▼
frontend FloatingAIAssistant.jsx
   │  appends assistant bubble (text or data table)
   │  persists sessionId in sessionStorage (per admin)
```

---

## 3. Frontend Architecture

### Files

```
frontend/src/admin/
├── AdminLayout.jsx                          ← mounts <FloatingAIAssistant/>
├── features/ai-assistant/
│   ├── FloatingAIAssistant.jsx              ← THE global component
│   ├── ChatWindow.jsx                       ← scrollable message list + auto-scroll
│   ├── MessageBubble.jsx                    ← renders one message
│   └── ReminderTable.jsx                    ← renders member data tables
└── styles/AiAssistant.css                   ← all floating-widget styles (isolated)
```

### Mount point

`AdminLayout.jsx` renders `<FloatingAIAssistant />` as a sibling of
sidebar/header/main. Because `AdminLayout` sits inside `<AuthGuard>` →
`<AdminContext.Provider>`, the widget always has the authenticated admin and
the current router location.

### Visibility rule (single source of truth)

In `FloatingAIAssistant.jsx`:

```js
const MODULE_PATHS = {
  "/admin":                        "dashboard",
  "/admin/members":                "all_members",
  "/admin/attendance-front-desk":  "attendance",
  "/admin/inactivity-reports":     "inactivity_reports",
  "/admin/enquiries":              "customer_enquiries",
};
const shouldRender = admin?.role === "superadmin"
                  && MODULE_PATHS[location.pathname];
if (!shouldRender) return null;
```

The launcher / widget simply does not render on other routes or for other
roles. This is a **UI convenience, never a security boundary** — the backend
re-checks superadmin on every request.

### State model (local component state)

| State | Purpose |
|---|---|
| `isOpen` | launcher vs panel |
| `messages[]` | rendered conversation (`{ id, role, content, type, data, timestamp }`) |
| `inputText` | composer |
| `isLoading` | in-flight guard (disables input + button, shows "…") |
| `error` | inline error banner |
| `sessionId` | current backend chat session (persisted per admin in sessionStorage) |
| `historyLoaded` | only fetch history once per admin per open |

### Session persistence across navigation

- `sessionKeyFor(adminId) = "gym_ai_session_<adminId>"` stored in
  **sessionStorage**.
- Closing the widget does **not** clear the session — reopening reuses the
  stored `sessionId` and calls `GET /api/ai/sessions/:id` to restore the
  conversation.
- Navigating Dashboard → All Members keeps the **same session**; only
  `currentModule` changes (sent on the next message).
- "New chat" (`FiPlus`) clears the stored session and starts fresh.

### Interactions

- Launcher: `FiMessageCircle`, fixed bottom-right, opens panel.
- Panel: header ("Giri Gym Assistant" + Online dot + New chat + Close), body
  (`ChatWindow`), composer (`input` + `Send`).
- Enter submits; Escape closes; input auto-focused on open.
- Errors: 429 → *"You're sending requests too quickly…"*; 500/502 →
  *"The assistant is temporarily unavailable…"*; else server message.

### Responsive behaviour (`AiAssistant.css`)

| Breakpoint | Launcher | Panel |
|---|---|---|
| Desktop | 56px, right:24px bottom:24px | 400px wide, 560px tall |
| ≤480px (mobile) | 52px, right:16px bottom:16px | **full-screen takeover** (inset 0, no radius/border) |

The widget is `position: fixed` with its own `z-index: 1000`; it never touches
the sidebar/header grid, so it cannot cause horizontal overflow or layout
shifts. The data table wraps in `overflow-x: auto` for small screens.

### Message rendering

- `message.role === "user"` → accent bubble, right-aligned.
- `role === "assistant"`, `type === "text"` → gray bubble, left-aligned.
- `type === "data"` → if `data.members[]` present, renders a `ReminderTable`
  (Name / Phone / Expiry / Days Left, capped at 10 rows + "…and N more");
  otherwise renders a generic key→value summary (ignores `members`/`results`
  keys).

---

## 4. Backend Architecture

### Directory layout

```
backend/src/
├── config/
│   ├── index.js          ← app-wide config (ai block updated)
│   └── aiConfig.js       ← ALL AI tunables from env (single source)
├── controllers/aiController.js
├── middleware/
│   ├── aiRateLimiter.js  ← per-admin rate limits
│   ├── adminAuth.js      ← shared auth (unchanged)
│   └── requireRole.js    ← shared role gate (unchanged)
├── models/
│   ├── ChatSession.js
│   ├── ChatMessage.js
│   └── AIUserMemory.js
├── routes/aiRoutes.js
└── services/ai/
    ├── chatService.js           ← orchestrator (processMessage)
    ├── sessionService.js        ← session CRUD + bounded history
    ├── memoryService.js         ← per-admin memory CRUD + pruning
    ├── promptTemplates.js       ← system prompt builder
    ├── toolSchemas.js           ← tool registry (whitelist)
    ├── toolExecutor.js          ← typed param validation + scope normalization
    ├── tools.js                 ← actual data-access functions
    ├── reminderService.js       ← WhatsApp reminder prep (kept, legacy-adjacent)
    ├── providerFactory.js       ← primary/fallback provider chain
    └── providers/
        ├── aiProvider.js             ← interface + error taxonomy
        ├── geminiProvider.js         ← adapter over @google/generative-ai
        └── openaiCompatProvider.js   ← adapter over any OpenAI-compatible endpoint
```

### Mounting & authorization (server.js)

```js
app.use("/api/ai", adminAuth, requireRole("superadmin"), aiRoutes);
```

- `adminAuth` requires `X-Session-Id` header, reads the session-scoped JWT
  cookie, verifies admin exists/active/canonical-role/`tokenVersion`, and
  validates the `AdminSession` document. Attaches `req.admin` + `req.sessionId`.
- `requireRole("superadmin")` → 401 if no `req.admin`, 403 for trainers.
- Both layers are **mandatory regardless of UI visibility**.

### Routes (`routes/aiRoutes.js`)

| Method | Path | Middleware | Controller |
|---|---|---|---|
| POST | `/chat` | hourly → per-minute limiter | `handleChat` |
| GET | `/sessions` | auth (global) | `listSessions` |
| GET | `/sessions/:id` | auth (global) | `loadSession` |
| POST | `/sessions/:id/archive` | auth (global) | `archiveSession` |
| GET | `/memory` | auth (global) | `listMemory` |
| DELETE | `/memory/:key` | auth (global) | `deleteMemory` |

Only `/chat` carries AI rate limits; read-only listing/archival endpoints share
the global `/api/` limiter (120/min) mounted in server.js.

### Request/response contract (`/chat`)

Request:
```json
{ "message": "how many members are expiring this week?",
  "sessionId": "…optional…",
  "currentModule": "dashboard" }
```

Success:
```json
{ "success": true,
  "sessionId": "<uuid>",
  "response": { "text": "7 member(s) …", "data": { ... } | null, "source": "ai" } }
```

Errors: 400 empty/too long, 403 non-superadmin, 404 forged session,
429 rate-limited, 5xx generic (never leaks provider internals).

---

## 5. Data Models

### ChatSession — one row per conversation

```js
{ sessionId: String   (unique, uuid)          // public handle the UI holds
  ownerUserId: ObjectId → Admin   (required, indexed)
  status: "active" | "archived"
  metadata: {}          // informational, e.g. last currentModule
  lastActivityAt: Date  // for ordering + future TTL
  timestamps }
```
Indexes: `{ ownerUserId:1, status:1, lastActivityAt:-1 }`,
`{ ownerUserId:1, sessionId:1 }`, unique `sessionId`.

### ChatMessage — one row per turn

```js
{ sessionId: String   (indexed)
  ownerUserId: ObjectId → Admin   (indexed)
  role: "user" | "assistant"
  content: String (required)
  messageType: "text" | "data" | "reminders" | "error"
  data: Object|null        // tool payload (e.g. member lists / counts)
  providerMetadata: Object|null  // reserved for debugging (model, latency)
  createdAt: Date (indexed)
  timestamps }
```
Indexes: `{ sessionId:1, createdAt:1 }`,
`{ ownerUserId:1, sessionId:1, createdAt:1 }`.

> **Never stored:** API keys, authorization headers, credentials, raw provider
> responses beyond `content`/`data`.

### AIUserMemory — one row per admin per key

```js
{ ownerUserId: ObjectId → Admin   (required)
  key: String (required)
  value: Object (required)   // small structured fact/preference
  source: String (default "ai")
  timestamps }
```
Indexes: unique `{ ownerUserId:1, key:1 }`, `{ ownerUserId:1, updatedAt:-1 }`.

---

## 6. Provider Abstraction (zero-code-change model switching)

### Interface (`providers/aiProvider.js`)

Every adapter implements one method:

```js
async generate({ systemPrompt, history = [], userMessage }) → Promise<string>
```

plus `name`, `modelName`, and `isConfigured`. Nothing else in the app knows
about a specific provider SDK.

### Error taxonomy

```js
ProviderErrorCodes = {
  AUTH,        // bad/missing key, config error            → NOT retryable
  RATE_LIMIT,  // provider 429                             → NOT retryable
  UNAVAILABLE, // provider down / 5xx                      → retryable
  TIMEOUT,     // exceeded timeout                         → retryable
  MALFORMED,   // empty/unparseable response               → NOT retryable
  UNKNOWN,
}
AIProviderError(message, code, retryable)
isRetryableProviderError(err)
```

### Adapters

| Adapter | Transport | Notes |
|---|---|---|
| `GeminiProvider` | `@google/generative-ai` SDK | `model.startChat({ history, systemInstruction })`; empty text → MALFORMED; maps SDK status → taxonomy |
| `OpenAICompatProvider` | native `fetch` | `POST {baseUrl}/chat/completions`; maps history `parts` → messages; `AbortController` timeout; works for OpenAI/OpenRouter/Groq/DeepSeek/… |

### Factory (`providerFactory.js`)

- `initializeProviders()` reads `aiConfig` and instantiates primary + optional
  fallback. Unknown provider name → warn + treat as unconfigured.
- `generateWithFallback(options)`:
  1. primary `generate` → success → log `{ provider, model, latencyMs }`.
  2. primary throws **non-retryable** (AUTH/RATE_LIMIT/MALFORMED) → rethrow.
  3. primary throws **retryable** (TIMEOUT/UNAVAILABLE) → try fallback.
  4. fallback succeeds → log + return.
  5. fallback fails → throw user-safe
     `"AI assistant is temporarily unavailable. Please try again in a moment."`
- **No blind retry storm:** bounded to exactly primary→fallback→(rule-based at
  the service layer). No infinite retry loops.

---

## 7. Configuration (`config/aiConfig.js` + `.env.example`)

| Env var | Default | Purpose |
|---|---|---|
| `AI_ENABLED` | `false` | master switch |
| `AI_PROVIDER` | `gemini` | `gemini` or `openai-compat` |
| `AI_MODEL` | `gemini-1.5-flash` | primary model name |
| `AI_API_KEY` | — | primary key (alias: `GEMINI_API_KEY`) |
| `AI_BASE_URL` | — | for `openai-compat` primary |
| `AI_FALLBACK_PROVIDER` | — | e.g. `openai-compat` |
| `AI_FALLBACK_MODEL` | — | fallback model |
| `AI_FALLBACK_API_KEY` | — | fallback key |
| `AI_FALLBACK_BASE_URL` | — | fallback endpoint |
| `AI_TIMEOUT_MS` | `15000` | per-call timeout |
| `AI_RATE_LIMIT_PER_MINUTE` | `20` | chat/min per admin |
| `AI_RATE_LIMIT_PER_HOUR` | `100` | chat/hour per admin |
| `AI_MAX_MESSAGE_LENGTH` | `2000` | input cap |
| `AI_MAX_HISTORY_PAIRS` | `10` | bounded history (20 msgs) |
| `AI_MAX_CONTEXT_LENGTH` | `10000` | reserved context budget |
| `AI_MAX_MEMORY_ITEMS` | `50` | memory per admin cap |

- All reads are centralized in `aiConfig.js` — no scattered `process.env`
  reads in business logic (the old `aiClient.js` scattering is gone).
- Secrets are env-only; never returned by any AI endpoint; frontend has no AI
  env vars.

---

## 8. Tools / Data Access Layer

### Registry (`toolSchemas.js`) — the ONLY surface the model can call

| Tool | Params | Returns |
|---|---|---|
| `getTotalMembers` | — | `{ count }` (scope-filtered) |
| `getActiveMembersCount` | — | `{ count }` (status=active, payment=paid) |
| `getExpiringMembers` | `days` 1–90 (default 7) | `{ count, members[], daysWindow }` |
| `getTodayAttendanceCount` | — | `{ count }` |
| `getInactiveMembers` | `days` 1–365 (default 30) | `{ count, members[] }` (cap 20) |
| `getEnquiriesSummary` | — | `{ new, contacted, closed, spam, total }` |
| `getDashboardSummary` | — | compact snapshot (parallel reads) |

- Unknown tool names rejected by `isValidTool`.
- No `requiresConfirmation` / side-effect tools in the current surface (the
  old `sendReminder` + `pendingActionStore` flow was removed; WhatsApp
  reminder *preparation* still exists in `reminderService.js` for the disabled
  `reminderAgent` cron job).

### Executor (`toolExecutor.js`)

- Validates every param: type (numbers accept numeric strings, coerced), then
  `min`/`max` bounds.
- **Scope normalization** — the model can never supply scope:
  ```js
  normalizedScope = Array.isArray(adminContext.scope) && length>0 ? scope : "all";
  ```
  i.e. superadmin `all` and headless system jobs (no admin context) see
  everything; an explicit gender list (reserved for future scoped roles) is
  honored. Tool calls without an authenticated context default to `all`
  (required by the cron reminder job), but the AI route itself is
  superadmin-only so scope is always `all` in practice.

### Data minimization (`tools.js`)

- Projection constant `PUBLIC_MEMBER_FIELDS = "fullName phone validityEnd gender gymPlan status"`.
- **Aadhaar, photo, medical, address, internal identifiers are never fetched**
  for AI results.
- Member lists carry only `name, phone, gender, validTill, daysLeft`
  (or `lastAttendance` for inactivity).
- Attendance counts resolve scoped member ids via a single `_id`-only query.

---

## 9. Chat Memory Techniques

Two distinct concepts, deliberately separated:

### A. Conversation history (per session, bounded)

- Stored in `ChatMessage` documents scoped by `sessionId` **and**
  `ownerUserId`.
- `sessionService.getHistory(sessionId, ownerUserId)`:
  - ownership-checked (`ChatSession.findOne({ sessionId, ownerUserId })`)
  - fetches ascending, keeps **last `MAX_HISTORY_PAIRS × 2`** messages (10
    pairs / 20 messages default)
  - maps to provider format `[{ role: "user"|"model", parts:[{text}] }]`
- **Bounded on both ends:** never loads the entire conversation into the
  provider prompt; never unbounded growth in MongoDB.
- `getSessionMessages()` is the *frontend-facing* variant (raw docs with
  `role/content/messageType/data`) used by `GET /sessions/:id`.

### B. Long-term memory (per admin, structured, capped)

- `AIUserMemory` documents: `{ ownerUserId, key, value, source }`.
- `memoryService`:
  - `getMemory/setMemory/deleteMemory` — all ownership-scoped
    (`findOne({ ownerUserId, key })`).
  - `listMemory(ownerUserId)` — sorted by `updatedAt`, capped at
    `AI_MAX_MEMORY_ITEMS` (50).
  - `pruneMemory(ownerUserId)` — deletes oldest beyond the cap (available but
    not auto-scheduled).
- Injected into the system prompt as "Known admin preferences/facts (use only
  as helpful context)" — small, explicit, structured. **No automatic
  everything-forever memory.**

### Isolation guarantees

Every query includes `ownerUserId`. Super Admin A can never read session or
memory of Super Admin B:

```js
ChatSession.findOne({ sessionId, ownerUserId })   // NOT findOne({ sessionId })
ChatMessage.find({ sessionId, ownerUserId })
AIUserMemory.findOne({ ownerUserId, key })
```

---

## 10. Prompt Construction (`promptTemplates.js`)

`buildSystemPrompt(currentModule, memory)` builds a single system message:

1. Role: "You are Giri Gym Assistant… insights about members, attendance,
   inactivity, enquiries, and the dashboard."
2. **FORMAT A** — structured tool call (single `{"tool":…}` or
   `{"steps":[…]}`).
3. **FORMAT B** — plain conversational text.
4. Rules: no prose around JSON, no code fences, day-phrase extraction
   ("2 weeks"=14, "1 month"=30, "soon"=7), never fabricate data, never ask
   for permissions.
5. Injected tool list (rendered from `TOOL_REGISTRY`).
6. Optional module hint: "The admin is currently viewing: dashboard."
7. Optional memory facts.

The provider output is parsed by `chatService.parseModelResponse`: strips code
fences → `JSON.parse` → only `tool`/`steps` objects are treated as tool calls;
anything else is treated as plain conversational text.

---

## 11. Security Model

| Layer | Mechanism |
|---|---|
| Authentication | `adminAuth` (JWT + `X-Session-Id` + `AdminSession` doc) |
| Authorization | `requireRole("superadmin")` on `/api/ai` mount; UI visibility is only cosmetic |
| Session isolation | every query carries `ownerUserId`; forged `sessionId` → 404 |
| Memory isolation | every memory query carries `ownerUserId` |
| Tool whitelist | model can only invoke registered tools |
| No raw MongoDB access | tools are fixed functions with typed params; no `$where`, no query injection |
| Prompt injection | regex blocklist (ignore instructions / system prompt / reveal secrets…) |
| Data minimization | projection never includes Aadhaar/photo/medical/address |
| Secrets | env-only keys; never serialized into messages/prompts/responses |
| Rate limiting | per-admin (not IP), per-minute + per-hour, before provider call |
| Input limits | message length 2000; history 10 pairs; memory 50 items |
| Timeouts | provider-level 15s; no hanging requests |

---

## 12. Rate Limiting (`middleware/aiRateLimiter.js`)

- `express-rate-limit` v8.
- `keyByAdmin(req)` → `admin:${req.admin.id}` (identity-based, not browser/IP),
  with `ipKeyGenerator()` fallback if `req.admin` is missing (defensive).
- `aiPerMinuteLimiter` → 20/min → 429 body
  `"You're sending requests too quickly. Please try again shortly."`
- `aiPerHourLimiter` → 100/hour → 429 body
  `"You've reached the hourly limit. Please try again later."`
- Applied **before** the provider is called, so rejected requests cost no
  provider calls.
- Limits are configurable via `AI_RATE_LIMIT_PER_MINUTE` /
  `AI_RATE_LIMIT_PER_HOUR`.

---

## 13. Error Handling & Fallback UX

### Provider failure ladder (inside `processMessage`)

1. primary success → respond.
2. primary retryable failure → fallback provider.
3. fallback failure (or AI disabled / not configured) → **rule-based fallback**
   (`buildRuleBasedResponse`) that can still answer total / expiring /
   attendance / enquiry questions using the tool layer.
4. Only truly unexpected application errors bubble to the route → 5xx.

### Frontend error mapping

| HTTP | Frontend message |
|---|---|
| 429 | "You're sending requests too quickly. Please try again shortly." |
| 500 / 502 | "The assistant is temporarily unavailable. Please try again in a moment." |
| other | server-provided message or generic fallback |

### What is never surfaced

API keys, provider credentials, stack traces, raw provider error bodies.

### Server-side observability (logger)

- `[AI] request completed` — provider, model, latency.
- `[AI] primary provider failed` / `[AI] fallback provider also failed` —
  error, code, retryable, latency.
- `[AI] chat request` — adminId, sessionId, source, module.
- `[AI][gemini]` / `[AI][openai-compat]` — provider-level errors.
- **No full conversation contents logged by default.**

---

## 14. What Was Removed (old implementation)

| File | Reason |
|---|---|
| `services/ai/aiClient.js` | direct Gemini client — replaced by adapters |
| `services/ai/aiCache.js` | in-memory response cache — removed (history is DB-backed) |
| `services/ai/conversationStore.js` | in-memory `Map` sessions — replaced by MongoDB |
| `services/ai/pendingActionStore.js` | confirmation tokens — side-effect flow removed |
| `services/ai/agentRunner.js` | multi-step runner with confirmation gate — replaced |
| `routes/aiRoutes.js` `POST /confirm` | obsolete |
| `frontend/…/AiAssistant.jsx` (full page) | replaced by floating widget |
| `App.jsx` `/admin/ai-assistant` route + lazy import | obsolete |
| `AdminSidebar` AI Assistant nav item, `FiCpu` | obsolete |
| `AdminHeader` `/admin/ai-assistant` title | obsolete |
| `MessageBubble` confirmation/reminders types, WhatsApp buttons | obsolete UI states |
| `AiAssistant.css` full-page panel styles | replaced by floating widget styles |

Kept: `reminderService.js` (used by the disabled `reminderAgent` cron) and the
`sendReminder`-free tool set.

---

## 15. Environment Variables Required

See §7. Variable **names** only:

```
AI_ENABLED
AI_PROVIDER
AI_MODEL
AI_API_KEY            (GEMINI_API_KEY accepted as alias)
AI_BASE_URL
AI_FALLBACK_PROVIDER
AI_FALLBACK_MODEL
AI_FALLBACK_API_KEY
AI_FALLBACK_BASE_URL
AI_TIMEOUT_MS
AI_RATE_LIMIT_PER_MINUTE
AI_RATE_LIMIT_PER_HOUR
AI_MAX_MESSAGE_LENGTH
AI_MAX_HISTORY_PAIRS
AI_MAX_CONTEXT_LENGTH
AI_MAX_MEMORY_ITEMS
```

---

## 16. Testing

- `backend/src/tests/ai.test.js` (no DB required):
  - `AIProviderError` taxonomy + retryable detection
  - tool registry completeness + param definitions
  - `executeTool` param validation (unknown tool, bad type, min/max bounds,
    defaults) with model stubbing
  - chat input validation (empty / too long / HTML strip)
  - rate-limiter middleware exports
  - `aiConfig` defaults
  - `buildSystemPrompt` content + module context
  - `requireRole("superadmin")` denies trainer / allows superadmin
  - session/memory service **ownership-boundary static checks**
  - provider factory status shape
- Existing suite: `security.test.js` (41 tests) still green.
- **Live provider/DB round trip not exercised by the unit suite** — requires a
  running MongoDB and a configured AI key (see §17).

---

## 17. Known Gaps / Risks

1. **No live provider test performed** — Gemini/OpenAI paths are unit-tested
   for logic but not executed against a real endpoint or a running MongoDB
   during development.
2. **`maxContextLength` is defined but not yet enforced** as a hard truncation
   budget — history is bounded by pairs, but a 10-pair × long-content session
   could still grow; enforcing the char budget is the natural next step.
3. **`pruneMemory` is available but not scheduled** — a daily job or
   on-write check would enforce `AI_MAX_MEMORY_ITEMS` over time.
4. **No audit trail for AI chat/tool actions** (existing gap carried over) —
   chat messages are stored, but no `auditLog` entries are written.
5. **Rule-based fallback** answers a fixed keyword set; provider outage yields
   narrower answers for arbitrary questions.
6. **Per-process limiter storage** (`express-rate-limit` in-memory) is
   single-instance; multi-instance deploys need a shared store
   (`rate-limiter-flexible` with Redis is already a dependency).
7. **Session rows grow without a TTL** — `ChatSession`/`ChatMessage` have no
   automatic expiration; an archival cron would bound collection growth.
8. **Widget has no unread-indicator/badge** on the launcher (deliberately
   minimal per requirements).
