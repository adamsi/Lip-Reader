# Plan: Conversations + autonomous reflect (second character, context-aware agent)

## Goals

1. **Make the agent genuinely autonomous.** Today `reflect` nearly always approves because
   correcting a single sentence is too easy. After this change, the first `generate` stays
   **stateless** (no conversation context), while `reflect` sees the **conversation history**
   — so it can catch corrections that are plausible in isolation but wrong in context, and
   route back to `generate` (which then gets history + feedback) for a real revision.
2. **Add conversations with a second character.** In both the Run Agent panel and the
   lip-reading Talk screen the user can start a new chat or continue an existing one, add
   messages from the *other* character manually, and the agent's predictions become the
   *user's own* messages in the chat.
3. **Keep every existing feature and API contract working** (same `/api/*` shapes, TTS,
   voices, presets, steps trace), keep predictions high-quality, and keep latency good
   (≤3 LLM calls worst case, bounded history window).
4. **Warm the Modal VSR service on page open** so cold start begins at page load, not at the
   first `execute_lips` call.

## Explicit requirements (from user)

- Chat UI additions must be **simple and clean**, in both Run Agent and Talk screens:
  start new chat / continue existing chat / add other-character messages.
- The system predicts only the **self** user's messages, never the other character's.
- Conversation history is **NOT** given to the first `generate` pass; it IS given to
  `reflect` and to the second `generate` iteration. First generate is stateless.
- Chat messages + short-term memory implemented **similar to sigma-agent-server**
  (`C:\Users\adams\Desktop\Projects\API-Assistant-MultiAgent\sigma-agent-server`).
- Test end to end: with chat, without chat, difficult incorrect sentences where the
  context-free generate fails and reflect revises, and all input options/features.
- Don't break current features; API endpoints keep working as before.
- Update `assets/architecture.png` and every affected part of the system (db, presets, docs…).
- Reflect must actually play a role (not always approve) — but without degrading
  prediction quality or latency.
- The Modal service `/health` endpoint must be hit on client page open (cold-start warmup).

## The sigma-agent-server pattern being mirrored

Sigma's chat memory (explored in detail):
- Two tables: `chat_memory` (conversation id, description/title, sequence number) and
  `chat_messages` (autoincrement id, conversation FK, `type USER|ASSISTANT`, `content`).
  No timestamps; ordering identity is the autoincrement id.
- A thin **repository** module (create/list/get-messages/append/delete) — no ORM
  relationships, no LangGraph checkpointer. The graph stays stateless.
- **Short-term memory = last-N window**: each turn re-reads messages, maps stored roles to
  LLM roles, slices `[-MEMORY_WINDOW:]` (N=10), and injects them into the prompt.
- Provisional chat title derived from the first message.
- The (user, assistant) pair is persisted only **after** the model run completes.

### Adaptation decision (architecture reasoning)

Sigma persists to Postgres behind auth. This app has **no DB, no auth** (auth was removed in
the workshop refactor), and runs as two serverless services (Vercel Python function +
Modal GPU) with ephemeral filesystems and no shared storage. Standing up a hosted Postgres
just for chat titles/messages would add secrets, cross-service coupling, and latency, and
per-user separation would be meaningless without auth. It would also violate the privacy
posture ("only text leaves the device").

**Therefore: the conversation store lives client-side (localStorage), with the exact same
shape as sigma** — a `lib/chat.ts` repository module exposing sigma's repository API
(create / list / getMessages / append / delete, conversations ordered by a monotonic
sequence, messages by incrementing id, roles stored as `SELF|OTHER`), and the **last-10
window** is sliced client-side and sent with each agent request. The backend applies the
same window defensively and formats history into the reflect/revise prompts — i.e. sigma's
`_load_history` → `[-MEMORY_WINDOW:] `→ prompt-injection flow, with the "load" step
happening in the browser instead of Postgres. LangGraph remains checkpointer-free, exactly
like sigma. (There is no existing server DB to migrate — "db" changes = this store.)

## Implementation phases

### Phase 1 — Backend: conversation-aware agent

`backend/app/agent/graph.py`
- `State` gains `conversation: list[dict]` (`[{role: "self"|"other", content: str}]`).
- `generate` node: **first pass unchanged and history-free**. On revision
  (when `feedback` present), the user message additionally includes the formatted
  conversation transcript, previous correction, and reviewer feedback.
- `reflect` node: prompt now includes the formatted conversation transcript (when present)
  plus raw + correction.
- `run_agent(raw_text, conversation=None)`; window clamp `conversation[-10:]` (sigma's
  `MEMORY_WINDOW = 10`) and per-message length clamp for latency safety.
- Transcript formatting helper: `Other: …` / `You: …` lines, most recent last.

`backend/app/agent/prompts.py`
- `REFLECT_SYSTEM_PROMPT` rewritten: reflect is the **context judge**. Approve when the
  correction is natural AND consistent with the conversation; revise when a word/phrase is
  contextually implausible and a **visually similar** alternative (lip-reading confusions:
  p/b/m, f/v, t/d, s/z, vowel shifts) fits the conversation better. Feedback must name the
  suspect word and the contextual reason. Includes few-shot examples of both approve and
  contextual revise. Guardrails: never invent content, only visually-plausible
  substitutions, approve when in doubt (protects quality / avoids revision loops).
- `GENERATE_SYSTEM_PROMPT`: small addition explaining that on a revision pass a
  conversation transcript may be provided and feedback should be addressed using it,
  still only substituting visually similar words.

`backend/app/main.py`
- `ExecuteBody` gains optional `conversation: list[ConversationMessage] = []`
  (`role: Literal["self","other"]`, `content: str`). Passed to `run_agent`.
  Fully backward compatible — old `{"prompt": ...}` bodies behave identically.

`backend/app/vsr_main.py`
- `POST /api/execute_lips` gains an optional `conversation` form field (JSON string),
  validated and passed to `run_agent`. Same envelope, backward compatible.

`backend/app/meta.py`
- `AGENT_INFO` description/purpose updated (conversation-aware reflection); add a second
  prompt example showing a contextual revise run (real recorded run). Keeps the exact keys
  the e2e check asserts.

### Phase 2 — Frontend: chat store + UI + warmup

`app/src/lib/chat.ts` (new — sigma repository mirror over localStorage)
- Types: `ChatMessage {id, role: "self"|"other", content}`,
  `Conversation {id, title, seq}`. Storage key `chaplin_chats` (follows `lib/voice.ts`
  convention).
- API: `createConversation(firstMessageOrTitle)` (provisional title from first words, like
  sigma's `_provisional_title`), `listConversations()` (newest first by seq),
  `getMessages(id)`, `appendMessage(id, role, content)`, `deleteConversation(id)`,
  `historyWindow(id)` → last 10 messages mapped to wire shape `{role, content}`.

`app/src/lib/api.ts`
- `executeText(prompt, conversation?)` and `executeLips(clip, conversation?)` send the
  optional history. `warmBackend()` already pings `${VSR_BASE}/health` on page load
  (main.tsx, before first render) — **verify** it fires the Modal URL in prod and keep;
  declare `VITE_VSR_API_BASE` in `vite-env.d.ts` (existing gap).

Chat UI (simple + clean, matching existing Tailwind glass style)
- New `ChatPanel.tsx` component: message list (self right / other left bubbles), chat
  picker (**New chat** + dropdown of existing chats + delete), input row to add an
  **other-character** message. Reused by both surfaces.
- Conversation state lifted to a light `ChatContext` (first shared store in the app) so
  Run Agent and Talk screen share the active chat.
- `RunAgentPanel.tsx`: optional chat mode — when a chat is active, show ChatPanel above the
  prompt input; agent result is appended as a **self** message (steps trace accessible per
  message); with no chat selected, behavior is exactly today's. Presets updated to include
  context-dependent ambiguous sentences (paired with suggested other-messages) that
  demonstrate the autonomous revise.
- `TalkScreen.tsx`: a compact chat toggle/sheet — pick/start a chat, see recent messages,
  add other-character messages; a successful lip-read prediction appends as a self message.
  Camera flow, phases, TTS word-sync all unchanged when no chat is active.

### Phase 3 — Architecture diagram + docs

- Regenerate `assets/architecture.png`: webcam → vsr → generate (stateless) → reflect
  (+ conversation history) → revise loop (history + feedback) → response/TTS, with the
  client-side chat store feeding the history into reflect. Module names stay exactly
  `vsr` / `generate` / `reflect` (must match steps + e2e assertions).
- Update `README.md` + `CLAUDE.md` architecture blurbs; AboutModal copy if it describes
  the agent flow.

### Phase 4 — Tests / verification

- `backend/e2e_check.py`: add a stage — `/api/execute` **with conversation** using a
  difficult ambiguous sentence where the context-free first generate produces the wrong
  word; assert the reflect step returns `revise` and a second generate fixes it (module
  sequence `generate, reflect, generate`), plus the existing no-conversation stages
  unchanged.
- New `tests/test_agent_conversation.py`: agent-level cases — (a) without context: still
  corrects normal noisy sentences with 1–2 calls and approves; (b) with context: at least
  2–3 curated ambiguous cases revise to the contextually right word; (c) history never
  leaks into the first generate step's recorded prompt (assert on `steps`).
- Run: `uv run python backend/e2e_check.py` and `uv run --extra test pytest tests/ -v -s`.
- Browser E2E (dev servers via launch configs + browser pane): Run Agent without chat
  (presets + free text), Run Agent with chat (new chat, continue chat, other-character
  messages, revise-in-context case, per-message steps trace), Talk screen UI states, About
  modal, voice onboarding, TTS speak, warmup request visible in network log on page load.
- Latency check: report per-call timings; typical path stays 2 LLM calls.

## Acceptance criteria

1. `POST /api/execute {"prompt": ...}` (no conversation) — byte-compatible behavior/shape.
2. `POST /api/execute` with `conversation` — reflect prompt contains the transcript; first
   generate step's recorded prompt does **not**.
3. At least 2 curated ambiguous sentences: context-free run yields word X, in-context run
   yields reflect `revise` → corrected word Y (the contextually right, visually similar one).
4. Normal sentences still approve on first pass (no regression in quality or latency).
5. Both UIs can create/continue chats, add other-character messages, and agent predictions
   append as self messages; chats persist across reloads (localStorage).
6. `/health` on the Modal service is requested at page open (network log proof).
7. `e2e_check.py` all stages PASS (where env allows: keys, weights, camera); pytest suite
   passes; architecture.png reflects the new flow and is served by `/api/model_architecture`.

## Risks / assumptions

- **Over-revision risk**: a pushier reflect could start revising good corrections. Mitigated
  by approve-by-default guardrails + few-shot approve examples + tests asserting normal
  sentences still approve.
- **Latency**: history window hard-capped at 10 messages / clamped content; worst case stays
  3 LLM calls. Reflect prompt grows by ~a few hundred tokens only when a chat is active.
- **No server DB by design** (see adaptation decision); if a future multi-device need
  appears, the wire shape already matches sigma's tables 1:1.
- Modal cold start: warmup ping already exists in `main.tsx`; if the deployed bundle
  predates it, a redeploy of the SPA is required for prod effect.
- Talk-screen camera flow can't be fully exercised headlessly (no lips to read);
  covered by e2e_check's clip path + UI-state browser checks, limitation reported.
