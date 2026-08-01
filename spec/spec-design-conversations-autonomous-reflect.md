---
title: Conversations with a Second Character and Context-Aware Autonomous Reflect Agent
version: 1.0
date_created: 2026-08-01
owner: Adam Sion (Chaplin AI)
tags: [design, architecture, app, agent, langgraph, chat, frontend, backend]
---

# Introduction

This specification defines the "conversations" feature for Chaplin AI: a client-side chat
store with a second character ("other"), a conversation-aware LangGraph reflection agent in
which the first `generate` pass is stateless while `reflect` and the revision pass receive
conversation history, backward-compatible API extensions, chat UI in both the Run Agent
panel and the Talk screen, a regenerated architecture diagram, and end-to-end verification.
The chat storage and short-term memory design mirrors the `sigma-agent-server` project
pattern (conversation header + ordered messages, thin repository API, last-N message
window, stateless graph), adapted to a serverless, no-auth, privacy-first deployment by
persisting conversations in browser `localStorage` and sending the history window with each
agent request.

## 1. Purpose & Scope

**Purpose**: Make the reflection agent genuinely autonomous (the `reflect` node must make
real approve/revise decisions grounded in conversation context) and let users hold
two-party conversations where the system predicts only the self user's messages.

**Scope**: Backend agent graph and prompts (`backend/app/agent/`), both FastAPI apps
(`backend/app/main.py`, `backend/app/vsr_main.py`), agent metadata (`backend/app/meta.py`),
React SPA (`app/src/`), architecture image (`assets/architecture.png`), end-to-end checks
(`backend/e2e_check.py`), and the pytest suite (`tests/`).

**Out of scope**: VSR model internals (`backend/pipelines/`, `backend/espnet/`), TTS
(`backend/app/tts.py`), voice onboarding, Modal deployment topology, authentication,
server-side databases.

**Audience**: Generative AI implementers and maintainers of this repository.

**Assumptions**: `ANTHROPIC_API_KEY` available for agent runs; the SPA is built with
React 18 + Vite + Tailwind (no router, no state library); deployment is Vercel (SPA +
API function) + Modal (VSR GPU service).

## 2. Definitions

- **VSR**: Visual Speech Recognition — the Auto-AVSR lip-reading model producing an
  imperfect ALL-CAPS transcription of one utterance.
- **Agent**: The LangGraph reflection workflow `generate → reflect → (revise once | END)`.
- **Self / self message**: A message authored by the primary user (the patient). Only self
  messages are produced by the agent (from lip-reading or typed prompts).
- **Other / other message**: A message from the second character (e.g. clinician/family),
  typed manually into the chat UI. Never processed by the agent as input to correct.
- **Conversation / chat**: An ordered list of self/other messages with an id and title.
- **History window**: The last `MEMORY_WINDOW = 10` messages of the active conversation,
  sent to the backend with an agent request (mirrors sigma-agent-server).
- **Stateless first pass**: The first `generate` invocation receives ONLY the raw
  transcription — no conversation history.
- **Steps trace**: The per-request list of `{module, prompt, response}` entries returned by
  the API (`vsr`, `generate`, `reflect` modules).
- **sigma pattern**: The chat memory implementation of
  `C:\Users\adams\Desktop\Projects\API-Assistant-MultiAgent\sigma-agent-server`:
  conversation table + message table (autoincrement ordering, role stored per message),
  repository functions, last-10 window re-read each turn, no LangGraph checkpointer.

## 3. Requirements, Constraints & Guidelines

### Agent behavior

- **REQ-001**: The agent graph state SHALL carry `conversation: list[{role, content}]`
  where `role ∈ {"self", "other"}`; `run_agent(raw_text, conversation=None)` SHALL accept
  it and default to no history.
- **REQ-002**: The FIRST `generate` invocation SHALL NOT include any conversation history
  in its prompt (system or user). Its recorded step prompt must contain no transcript.
- **REQ-003**: The `reflect` invocation SHALL include the formatted conversation transcript
  (when history is non-empty) together with the raw transcription and the correction.
- **REQ-004**: A revision `generate` invocation (after `reflect` verdict `revise`) SHALL
  include the conversation transcript, the previous correction, and the reviewer feedback.
- **REQ-005**: `reflect` SHALL revise when a corrected word/phrase is contextually
  implausible AND a visually similar alternative (lip-reading confusion classes: p/b/m,
  f/v, t/d, s/z, similar vowel shapes) is contextually plausible; feedback SHALL name the
  suspect word and the contextual reason.
- **REQ-006**: `reflect` SHALL approve when the correction is natural, faithful, and
  contextually consistent — approve is the default when uncertain (quality guardrail).
- **REQ-007**: Maximum one revision (existing `generations > 1 → END` rule preserved);
  worst case remains 3 LLM calls per request.
- **CON-001**: The backend SHALL clamp incoming history to the last 10 messages and clamp
  each message's content length (≤ 500 characters) before prompt injection.
- **CON-002**: Graph remains compiled once at import, without a checkpointer (sigma
  pattern: memory is a storage concern, not a graph concern).

### API

- **REQ-010**: `POST /api/execute` body SHALL be `{prompt: str, conversation?: [{role:
  "self"|"other", content: str}]}`. Omitted/empty `conversation` yields behavior identical
  to the current implementation. Response envelope unchanged:
  `{status, error, response, steps}`.
- **REQ-011**: `POST /api/execute_lips` SHALL accept an optional multipart form field
  `conversation` containing the same list JSON-encoded as a string; invalid JSON is
  ignored (treated as no history), never a 4xx/5xx.
- **REQ-012**: All other endpoints (`/api/team_info`, `/api/agent_info`,
  `/api/model_architecture`, `/health`, `/voices`, `/speak`, `/voice/*`) SHALL keep their
  current contracts byte-compatible.
- **REQ-013**: `/api/agent_info` SHALL be updated to describe the conversation-aware
  reflection and include at least one prompt example demonstrating a contextual revise,
  while keeping the exact key structure asserted by `backend/e2e_check.py`
  (`description`, `purpose`, `prompt_template.template`, `prompt_examples[].{prompt,
  full_response, steps}`).

### Chat store (frontend, sigma mirror)

- **REQ-020**: A new module `app/src/lib/chat.ts` SHALL implement the repository API over
  `localStorage` key `chaplin_chats`: `createConversation`, `listConversations` (newest
  first by monotonic sequence), `getMessages` (ascending id), `appendMessage`,
  `deleteConversation`, `historyWindow` (last 10 messages in wire shape).
- **REQ-021**: Message shape: `{id: number (monotonic per conversation), role:
  "self"|"other", content: string}`. Conversation shape: `{id: string (uuid), title:
  string, seq: number (monotonic across conversations)}`.
- **REQ-022**: New conversations SHALL get a provisional title derived from their first
  message (first ~4 words, like sigma's `_provisional_title`); a conversation MAY be
  created empty with a default title.
- **REQ-023**: A self message is appended only AFTER a successful agent response
  (sigma's persist-after-completion rule). Other messages append immediately.

### UI

- **REQ-030**: Both the Run Agent panel and the Talk screen SHALL offer: start new chat,
  continue an existing chat (picker), add an other-character message, and view the
  conversation as chat bubbles (self right-aligned, other left-aligned).
- **REQ-031**: With no active chat, both surfaces SHALL behave exactly as today
  (single-result flow, no history sent).
- **REQ-032**: When a chat is active: a Run Agent result / successful lip-read prediction
  is appended as a self message; the request includes `historyWindow` of the active chat
  (history is captured BEFORE appending the new self message).
- **REQ-033**: Per-self-message steps trace SHALL remain accessible (reusing
  `StepsTrace`).
- **REQ-034**: Active-chat selection SHALL be shared between the two surfaces (React
  context or lifted state in `App.tsx`).
- **REQ-035**: Chat UI SHALL be visually consistent with the existing Tailwind glass
  style (`animate-pop`, rounded-3xl cards, violet/indigo palette) and mobile-safe
  (safe-area insets, `sm:` breakpoints).
- **REQ-036**: Run Agent presets SHALL be extended with at least 2 context-dependent
  ambiguous VSR-style sentences that demonstrate a contextual revise when used inside a
  chat with appropriate other-messages.
- **REQ-037**: Deleting a conversation SHALL require no confirmation beyond a single
  click but SHALL only delete the selected conversation.

### Warmup

- **REQ-040**: On SPA page open (before first render), the client SHALL fire
  `GET {VSR_BASE}/health` (Modal service) and `GET {API_BASE}/health`, fire-and-forget.
  (Already implemented in `app/src/lib/api.ts` `warmBackend()`; verify, keep, and add the
  missing `VITE_VSR_API_BASE` declaration to `vite-env.d.ts`.)

### Documentation & diagram

- **REQ-050**: `assets/architecture.png` SHALL be regenerated to show: webcam → vsr →
  generate (stateless) → reflect (with conversation history from the client chat store) →
  conditional revise loop → response/TTS. Module labels exactly `vsr`, `generate`,
  `reflect`.
- **REQ-051**: `README.md` and `CLAUDE.md` architecture descriptions SHALL be updated;
  AboutModal copy updated if it describes the agent flow.

### Security & privacy

- **SEC-001**: Conversations SHALL NOT be persisted server-side; only the text history
  window leaves the browser, per request.
- **SEC-002**: No secrets are added; no auth is added.

### Guidelines

- **GUD-001**: Smallest diff; match existing code style (concise modules, Tailwind inline
  classes, no new dependencies unless unavoidable — no state library).
- **GUD-002**: Follow current LangChain/LangGraph idioms (structured output bindings,
  typed state, conditional edges) already used in `backend/app/agent/`.
- **PAT-001**: Mirror sigma-agent-server naming/shape where sensible: `MEMORY_WINDOW = 10`,
  repository verbs, role stored on each message, provisional title.

## 4. Interfaces & Data Contracts

### 4.1 Wire shape: conversation history

```jsonc
// ConversationMessage (wire)
{ "role": "self" | "other", "content": "string (clamped to 500 chars server-side)" }
```

### 4.2 POST /api/execute

```jsonc
// request
{ "prompt": "CAN YOU TURN UP THE BAT", "conversation": [
    { "role": "other", "content": "It's freezing in this room." },
    { "role": "self",  "content": "I know, sorry." }
] }
// response (unchanged envelope)
{ "status": "ok", "error": null, "response": "Can you turn up the heat?",
  "steps": [ { "module": "generate", "prompt": {"system": "...", "input": "..."}, "response": {"corrected": "..."} },
             { "module": "reflect",  "prompt": {"system": "...", "input": "..."}, "response": {"verdict": "revise", "feedback": "..."} },
             { "module": "generate", "prompt": {"system": "...", "input": "..."}, "response": {"corrected": "..."} } ] }
```

### 4.3 POST /api/execute_lips (multipart)

| field          | type   | required | description                                   |
|----------------|--------|----------|-----------------------------------------------|
| `file`         | file   | yes      | mp4/webm clip (unchanged)                     |
| `conversation` | string | no       | JSON-encoded `ConversationMessage[]`          |

Response envelope unchanged; `steps[0].module == "vsr"`.

### 4.4 Agent internals

```python
class State(TypedDict):
    raw_text: str
    conversation: list[dict]      # [{"role": "self"|"other", "content": str}]
    corrected: str
    verdict: str
    feedback: str
    generations: int
    steps: Annotated[list[dict], operator.add]

def run_agent(raw_text: str, conversation: list[dict] | None = None) -> dict: ...
MEMORY_WINDOW = 10

# Transcript formatting (only in reflect + revision prompts):
# "Other: It's freezing in this room.\nYou: I know, sorry."
```

### 4.5 Frontend chat store (`app/src/lib/chat.ts`)

```ts
export type ChatRole = "self" | "other";
export type ChatMessage = { id: number; role: ChatRole; content: string };
export type Conversation = { id: string; title: string; seq: number };
export const MEMORY_WINDOW = 10;

export function createConversation(firstContent?: string): Conversation;
export function listConversations(): Conversation[];          // newest first
export function getMessages(conversationId: string): ChatMessage[];
export function appendMessage(conversationId: string, role: ChatRole, content: string): ChatMessage;
export function deleteConversation(conversationId: string): void;
export function historyWindow(conversationId: string): { role: ChatRole; content: string }[];
```

### 4.6 API client (`app/src/lib/api.ts`)

```ts
export async function executeText(prompt: string, conversation?: WireMessage[]): Promise<ExecuteResult>;
export async function executeLips(clip: Blob, conversation?: WireMessage[]): Promise<ExecuteResult>;
export function warmBackend(): void; // GET {API_BASE}/health + GET {VSR_BASE}/health, catch-all
```

## 5. Acceptance Criteria

- **AC-001**: Given a request `{"prompt": "IM SO EXCITED TO ME YOU TODAY"}` with no
  `conversation`, When `/api/execute` runs, Then the response envelope, module sequence,
  and correction quality match current behavior (steps ⊆ {generate, reflect}).
- **AC-002**: Given a request with non-empty `conversation`, When the steps trace is
  inspected, Then the FIRST `generate` step's recorded prompt contains no conversation
  content, and the `reflect` step's recorded prompt contains the transcript.
- **AC-003**: Given a curated ambiguous prompt whose context-free correction is wrong
  (e.g. raw `CAN YOU TURN UP THE BAT` after other-message "It's freezing in this room"),
  When executed with that conversation, Then `reflect` returns `revise` and the final
  response contains the contextually correct, visually similar word (`heat`), with module
  sequence `generate, reflect, generate`.
- **AC-004**: Given ≥ 3 normal noisy sentences with no conversation, When executed, Then
  `reflect` approves on the first pass for at least 2 of 3 (no over-revision regression).
- **AC-005**: Given the SPA in a browser, When the user creates a chat in Run Agent, adds
  an other message, and runs a prompt, Then the prediction appears as a self bubble, the
  other message as a left bubble, and the chat survives a page reload.
- **AC-006**: Given the Talk screen with an active chat, When a lip-read prediction
  succeeds, Then it is appended as a self message to the same chat visible in Run Agent.
- **AC-007**: Given the SPA loads, When the network log is inspected, Then a request to
  `{VSR_BASE}/health` was fired at page open.
- **AC-008**: Given `uv run python backend/e2e_check.py`, When run with keys/weights
  present, Then all stages including the new conversation stage report PASS.
- **AC-009**: Given `/api/execute_lips` with an invalid `conversation` form value, When
  processed, Then the request succeeds as if no history was provided.
- **AC-010**: Given `GET /api/model_architecture`, Then it serves the regenerated PNG
  (image/png) whose module labels are exactly `vsr`, `generate`, `reflect`.

## 6. Test Automation Strategy

- **Test Levels**: Unit/agent-level (pytest), service-level (FastAPI TestClient in
  `e2e_check.py`), browser E2E (dev servers + in-app browser pane).
- **Frameworks**: pytest (+ existing conftest word-overlap summary machinery untouched),
  FastAPI TestClient, Vite dev server + browser-pane verification.
- **New tests**: `tests/test_agent_conversation.py` — (a) no-context corrections still
  approve; (b) ≥ 2 ambiguous cases revise to the contextual word; (c) assert first
  generate step prompt contains no transcript while reflect step does; marked to skip
  when `ANTHROPIC_API_KEY` is missing.
- **e2e_check.py**: new stage "execute (with conversation)" asserting AC-003; existing
  stages unchanged.
- **Test Data Management**: curated ambiguous sentence fixtures inline in the test file;
  no persistent test data.
- **CI/CD Integration**: none exists in repo; manual invocation via
  `uv run --extra test pytest tests/ -v -s` and `uv run python backend/e2e_check.py`.
- **Coverage Requirements**: no numeric threshold; all acceptance criteria exercised.
- **Performance Testing**: report per-request latency from e2e_check; typical path must
  remain 2 LLM calls, worst case 3.

## 7. Rationale & Context

- Reflect currently always approves because a single-sentence correction is almost always
  locally plausible. Giving reflect (and only reflect + revision) the conversation makes
  it the sole holder of context, so it can genuinely overrule the context-free generate —
  restoring a real decision boundary (autonomy) without adding LLM calls to the common
  path.
- The sigma-agent-server pattern is mirrored at the schema/flow level (header + ordered
  messages, repository verbs, last-10 window, stateless graph, persist-after-completion)
  but persisted client-side: this deployment has no database, no auth (removed in the
  workshop refactor), two serverless services with no shared storage, and a privacy rule
  that only text leaves the device. localStorage is the existing persistence convention
  (`lib/voice.ts`).
- Approve-by-default guardrails and visually-similar-substitution constraints protect
  prediction quality from an over-eager reviewer.

## 8. Dependencies & External Integrations

### External Systems
- **EXT-001**: Anthropic API — LLM calls for generate/reflect (existing).
- **EXT-002**: Modal — hosts the VSR service; its `/health` is the warmup target.
- **EXT-003**: Vercel — hosts SPA + API function; rewrites in `vercel.json` unchanged.

### Third-Party Services
- **SVC-001**: Inworld TTS — unchanged.

### Infrastructure Dependencies
- **INF-001**: Browser `localStorage` — conversation persistence (per-device).

### Data Dependencies
- **DAT-001**: None new; VSR weights and test videos as today.

### Technology Platform Dependencies
- **PLT-001**: Python 3.10+ (backend), LangGraph/LangChain-Anthropic (existing versions).
- **PLT-002**: React 18 + Vite 5 + Tailwind 3.4; NO new npm dependencies.

### Compliance Dependencies
- **COM-001**: Privacy posture — video never leaves device; conversations never stored
  server-side.

## 9. Examples & Edge Cases

```text
Curated ambiguous cases (context flips the correction):
1. other: "It's freezing in this room."     raw: CAN YOU TURN UP THE BAT
   context-free plausible: "Can you turn up the bat?"/"...the fan?"  → with context: "Can you turn up the heat?"
2. other: "The doctor said your throat is dry."  raw: I NEED SOME BORE WATER
   context-free: "I need some more water." (fine either way — approve)
3. other: "Your daughter is on the phone."  raw: TELL HER I LOVE HER SO BUCH
   context-free: "...so much." (approve; context agrees)
4. other: "Should I turn on the TV?"        raw: YES PUT ON THE MOVIE ABOUT THE SHEEP
   (approve — plausible either way; reflect must NOT invent revisions)

Edge cases:
- conversation: []                  → identical to omitted (stateless behavior end-to-end)
- conversation with >10 messages    → server clamps to last 10
- message content > 500 chars       → clamped before prompt injection
- execute_lips conversation field invalid JSON / wrong types → ignored, no error
- role values outside self|other    → request rejected by pydantic on /api/execute (422);
  filtered out on /api/execute_lips (lenient form path)
- localStorage unavailable (private mode edge) → chat features degrade to no-chat mode
  without crashing (try/catch in chat.ts)
- deleting the active conversation  → UI falls back to no-chat mode
```

## 10. Validation Criteria

- All acceptance criteria AC-001 … AC-010 verified (test run outputs reported honestly;
  environment-blocked stages explicitly declared).
- `uv run python backend/e2e_check.py` → OVERALL PASS.
- `uv run --extra test pytest tests/ -v -s` → all tests pass/skip as designed.
- Browser E2E walkthrough of: presets, free text, new chat, continue chat, other message,
  contextual revise demo, per-message steps, Talk screen states, About modal, voice
  onboarding untouched, TTS speak, warmup network request.
- `git diff` limited to files in scope; no API contract drift for existing clients.

## 11. Related Specifications / Further Reading

- [plan-to-implement.md](../plan-to-implement.md) (source plan for this spec)
- [spec-architecture-workshop-refactor-langgraph-agent.md](spec-architecture-workshop-refactor-langgraph-agent.md) (prior refactor)
- [PRD.md](../PRD.md) — product context (reliability over coverage)
- sigma-agent-server reference: `C:\Users\adams\Desktop\Projects\API-Assistant-MultiAgent\sigma-agent-server` (`app/chatbot/` chat memory stack)
