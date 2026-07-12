---
title: Workshop Refactor — Folder Restructure, LangGraph Reflection Agent, Required API & GUI
version: 1.0
date_created: 2026-07-12
owner: Chaplin AI team (Adam Sion, Jonathan Eshel)
tags: [architecture, app, api, agent, refactor]
---

# Introduction

This specification defines the refactor of the Chaplin AI lip-reading application (repository `lipreader`) to satisfy the course workshop requirements (`project_requierments.pdf`): a restructured repository layout, a minimal LangGraph reflection agent replacing the single Claude correction call, an exact set of HTTP API endpoints with steps tracing, a root-served single-page GUI with a "Run Agent" feature and About modal, and an excalidraw-style architecture PNG. Lip-reading (VSR) quality and latency must remain identical to the current state.

## 1. Purpose & Scope

**Purpose**: Make the existing application conform to the workshop's API/GUI/agent requirements while cleaning the repository structure and removing dead code.

**Scope**: Local development application (Windows, `uv`, FastAPI backend, React/Vite SPA). Cloud deployment (Vercel), Supabase, Pinecone, and the LLMod.ai provider are explicitly **out of scope**.

**Audience**: Generative AI implementers and project maintainers.

**Assumptions**: `ANTHROPIC_API_KEY` and `INWORLD_API_KEY` are present in `.env`; VSR weights exist under `benchmarks/LRS3/`; Node and uv toolchains installed.

## 2. Definitions

- **VSR**: Visual Speech Recognition — the Auto-AVSR lip-reading model in `pipelines/` (to be moved to `backend/pipelines/`).
- **Agent**: The LangGraph workflow that corrects raw VSR output.
- **Reflection pattern**: generate → reflect (critique) → optional single revision → return.
- **Steps trace**: Ordered array of `{module, prompt, response}` objects, one per LLM call performed during a request.
- **SPA**: Single-Page Application (`app/`, React + Vite + Tailwind).
- **Preset**: A canned, deliberately incorrect all-caps VSR-style sentence offered in the GUI dropdown.
- **espnet**: Vendored upstream model internals — must not be edited, only moved.

## 3. Requirements, Constraints & Guidelines

### Repository structure

- **REQ-001**: Create `assets/` at repo root containing: `assets/brand/` (from `brand/`), `assets/configs/` (from `configs/`), `assets/test_videos/` (from `test videos/`), `assets/sravi_test_videos/` (from `SRAVI test videos/`), `assets/chaplin_ai.pptx` (from repo root), and new `assets/architecture.png`.
- **REQ-002**: Move `espnet/` to `backend/espnet/` and `pipelines/` to `backend/pipelines/` without editing their code; imports resolve by adding `backend/` to `sys.path` in `backend/app/config.py`.
- **REQ-003**: `benchmarks/` remains at repo root (gitignored weights); the VSR `.ini` config's relative model paths must keep resolving.
- **REQ-004**: Delete: `legacy/`, `chaplin.py`, `setup.sh`, `vsr_output.png`, `lipreader.log`, root `__pycache__/`, `.pytest_cache/`, `backend/app/auth.py`, `app/android/`, `app/ios/`, Capacitor config/deps, `@clerk/clerk-react` if unused, `*.tsbuildinfo`.
- **REQ-005**: Keep: brand images, `chaplin_ai.pptx`, `README.md`, `PRD.md`, `CLAUDE.md`, `LICENSE`, `tests/`, `backend/e2e_check.py`.
- **REQ-006**: Update every path reference broken by the moves (`backend/app/config.py`, `tests/`, `backend/e2e_check.py`, README).
- **REQ-007**: Remove unused Python dependencies (`sqlalchemy`, `psycopg2-binary`, `pyjwt`, `sounddevice`) and add `langgraph`, `langchain-anthropic`, `langchain-core`.

### LangGraph agent

- **REQ-010**: New package `backend/app/agent/` with exactly three modules: `prompts.py`, `model.py`, `graph.py`.
- **REQ-011**: `graph.py` defines a `StateGraph` with two nodes named `generate` and `reflect`; edge `generate → reflect`; conditional edge from `reflect` returning either `generate` (revise) or `END` (return). Revision loop limit: **1** (worst case 3 LLM calls: generate, reflect, generate).
- **REQ-012**: `prompts.py` holds all node prompts. The `generate` prompt is an enhanced version of the current `LLM_SYSTEM_PROMPT` in `chaplin.py`, with few-shot examples. The `reflect` prompt uses few-shot examples if useful. Prompts are concise (minimize context size).
- **REQ-013**: `model.py` defines the `ChatAnthropic` chat model (temperature 0, bounded `max_tokens`) and structured-output bindings (Pydantic schemas) used by nodes.
- **REQ-014**: Both nodes use structured output. `generate` returns `{corrected: str}`. `reflect` returns `{verdict: "approve"|"revise", feedback: str}`.
- **REQ-015**: The graph state records the steps trace: every LLM call appends `{module, prompt, response}` where `module` ∈ {`generate`, `reflect`} and matches the architecture diagram labels.
- **REQ-016**: Code is short and idiomatic per current LangGraph patterns (TypedDict/Pydantic state, `StateGraph`, compiled once at module import, no helper-method sprawl).
- **REQ-017**: The agent is invoked synchronously per request; no persistence/checkpointing required.

### API (FastAPI)

- **REQ-020**: `GET /api/team_info` returns exactly:
  `{"group_batch_order_number": "1_1", "team_name": "Chaplin AI", "students": [{"name": "Adam Sion", "email": "adamsion74@gmail.com"}, {"name": "Jonathan Eshel", "email": "jonathan.eshel1@gmail.com"}]}`
- **REQ-021**: `GET /api/agent_info` returns JSON with keys `description`, `purpose`, `prompt_template` (object with key `template`), and `prompt_examples` (array of objects with keys `prompt`, `full_response`, `steps`). Examples must reflect real agent behavior.
- **REQ-022**: `GET /api/model_architecture` returns the PNG at `assets/architecture.png` with `Content-Type: image/png`.
- **REQ-023**: `POST /api/execute` accepts `{"prompt": "<text>"}` and returns exactly the top-level fields `{"status": "ok", "error": null, "response": "<corrected text>", "steps": [...]}`. On failure: `{"status": "error", "error": "<human-readable>", "response": null, "steps": []}`. HTTP status 200 in both cases (shape carries the error).
- **REQ-024**: `POST /api/execute_lips` accepts a multipart video file (mp4/webm), runs clip normalization → VSR → agent, and returns the same response shape as REQ-023. The steps array additionally begins with a `vsr` module step describing the lip-reading call (input: video, response: raw transcription).
- **REQ-025**: Every step object has exactly the keys `module`, `prompt`, `response`. Module names must be consistent across the architecture PNG, `/api/agent_info`, and steps logging.
- **REQ-026**: The endpoints `/health`, `/voices`, `/voice/enroll`, `/voice/select`, `/speak` remain functional and unchanged in contract. The legacy `/transcribe` endpoint is removed.
- **REQ-027**: The FastAPI app serves the built SPA (`app/dist/`) at the root URL `/` (static mount with SPA index fallback), with `/api/*` and existing endpoints taking precedence. No authentication anywhere.
- **REQ-028**: Uploaded clips are still deleted in a `finally` block immediately after inference (privacy invariant).

### Frontend (SPA)

- **REQ-030**: The existing camera Talk flow is preserved verbatim in UX but calls `POST /api/execute_lips` and reads `response`/`steps` from the new shape. Failure surfaces the friendly retry message as today.
- **REQ-031**: A "Run Agent" button opens a panel (overlay/modal within the SPA) containing: (a) a dropdown of ≥4 preset incorrect all-caps VSR-style sentences, (b) a free-text textarea, (c) a Run button that POSTs `/api/execute` with the chosen/entered text.
- **REQ-032**: After a run, the panel displays the final `response` prominently and the full `steps` trace (module, prompt, response per step), readable and collapsible.
- **REQ-033**: An "About" button opens a modal with the Chaplin logo, a short explanation of the system and its architecture (VSR → generate → reflect), and how to provide input (camera or Run Agent text).
- **REQ-034**: All interactions stay within the single page; smooth transitions; no page reloads; no login.
- **REQ-035**: The Speak/TTS flow (word-synced playback) continues to work for lip-read sentences.

### Architecture image

- **REQ-040**: `assets/architecture.png` is an excalidraw-style (hand-drawn aesthetic) diagram showing: webcam/browser → clip → `vsr` → `generate` → `reflect` → conditional (revise back to `generate`, max 1 / return) → response → GUI + optional TTS. Node labels must literally include the module names `vsr`, `generate`, `reflect`.

### Performance & efficiency

- **PERF-001**: `/api/execute` completes in ≤ 10 s typical (2 LLM calls), ≤ 15 s worst case (3 calls); no LLM call is made outside the graph nodes.
- **PERF-002**: `/api/execute_lips` latency must not regress versus the current `/transcribe` + correction beyond the added reflect call.
- **PERF-003**: VSR pipeline code, config, and weights are untouched — lip-reading output is bit-identical to before for the same clip.
- **CON-001**: Windows + PowerShell + `uv`; secrets stay in `.env`; never committed.
- **CON-002**: `espnet/` is vendored upstream — moved, never edited.
- **GUD-001**: Smallest diff that works; no speculative abstractions.
- **PAT-001**: LangGraph: `StateGraph(State)` + `add_node` + `add_conditional_edges` + `compile()`; nodes are plain functions returning partial state updates.

## 4. Interfaces & Data Contracts

### 4.1 `GET /api/team_info` → 200 `application/json`

```json
{
  "group_batch_order_number": "1_1",
  "team_name": "Chaplin AI",
  "students": [
    { "name": "Adam Sion", "email": "adamsion74@gmail.com" },
    { "name": "Jonathan Eshel", "email": "jonathan.eshel1@gmail.com" }
  ]
}
```

### 4.2 `GET /api/agent_info` → 200 `application/json`

```json
{
  "description": "…",
  "purpose": "…",
  "prompt_template": { "template": "…" },
  "prompt_examples": [
    { "prompt": "…", "full_response": "…", "steps": [ { "module": "generate", "prompt": {}, "response": {} } ] }
  ]
}
```

### 4.3 `GET /api/model_architecture` → 200 `image/png` (binary body)

### 4.4 `POST /api/execute`

Request: `{ "prompt": "IM SO EXCITED TO ME YOU TODAY" }`

Success response (HTTP 200):

```json
{
  "status": "ok",
  "error": null,
  "response": "I'm so excited to meet you today.",
  "steps": [
    { "module": "generate", "prompt": { "system": "…", "input": "…" }, "response": { "corrected": "…" } },
    { "module": "reflect",  "prompt": { "system": "…", "input": "…" }, "response": { "verdict": "approve", "feedback": "…" } }
  ]
}
```

Error response (HTTP 200): `{ "status": "error", "error": "…", "response": null, "steps": [] }`

### 4.5 `POST /api/execute_lips`

Request: `multipart/form-data`, field `file` = mp4/webm clip.
Response: same shape as 4.4; `steps[0].module == "vsr"` with `response` containing the raw transcription.

### 4.6 Agent state (internal)

```python
class State(TypedDict):
    raw_text: str          # input to correct
    corrected: str         # current draft
    feedback: str          # reflect feedback when revising
    revisions: int         # generate invocation count
    steps: list[dict]      # accumulated {module, prompt, response}
```

## 5. Acceptance Criteria

- **AC-001**: Given the server is running, when `GET /api/team_info` is called, then the byte-for-byte field values of §4.1 are returned.
- **AC-002**: Given a text prompt, when `POST /api/execute` is called, then the response contains exactly the four top-level keys with `status == "ok"`, a non-empty corrected `response`, and `steps` listing every LLM call in order with modules from {`generate`, `reflect`}.
- **AC-003**: Given the agent's reflect node returns `revise`, when the graph continues, then `generate` runs exactly once more and the graph ends (never a second revision).
- **AC-004**: Given a valid talking-head clip, when `POST /api/execute_lips` is called, then `steps[0].module == "vsr"` and the final `response` equals the agent-corrected transcription; the temp clip files are deleted afterward.
- **AC-005**: Given an unreadable clip (no face), when `POST /api/execute_lips` is called, then `status == "ok"` path is not faked — the response carries the friendly "didn't catch" text or an error shape, and no LLM call is wasted on empty input.
- **AC-006**: Given the built SPA, when browsing to the backend root `/`, then the GUI loads with textarea, Run Agent button, presets dropdown, steps trace display, About modal, and no auth.
- **AC-007**: Given `GET /api/model_architecture`, then a PNG renders and its labels include `vsr`, `generate`, `reflect` exactly as used in steps.
- **AC-008**: `uv run python backend/e2e_check.py` prints PASS for every stage; `uv run --extra test pytest tests/ -v -s` passes (skips allowed only for missing hardware/keys).
- **AC-009**: For the same input clip, raw VSR transcription is identical before and after the refactor.
- **AC-010**: Repo root contains only `app/`, `backend/`, `assets/`, `benchmarks/`, `tests/`, `spec/`, docs (`README.md`, `PRD.md`, `CLAUDE.md`, `LICENSE`, `plan-to-implement.md`, `project_requierments.pdf`), and toolchain files (`pyproject.toml`, `uv.lock`, `.env*`, `.gitignore`).

## 6. Test Automation Strategy

- **Test Levels**: Unit (agent graph with mocked model), Integration (`backend/e2e_check.py` via FastAPI TestClient), End-to-End (browser preview of the SPA + real endpoints), Eval (existing pytest word-overlap F1 suite).
- **Frameworks**: pytest (+ pytest-xdist, filelock), FastAPI TestClient, in-app browser verification (screenshots + network inspection).
- **Test Data Management**: preset sentences in code; SRAVI/test videos under `assets/`; temp clips in OS temp dir, always deleted.
- **CI/CD Integration**: none required (local project).
- **Coverage Requirements**: all five `/api/*` endpoints exercised by e2e_check; every GUI flow manually driven once via browser tooling.
- **Performance Testing**: wall-clock timing of `/api/execute` and `/api/execute_lips` printed by e2e_check; compare `/api/execute_lips` against pre-refactor `/transcribe` timing.

## 7. Rationale & Context

- The reflection pattern satisfies the course's "appropriate agent architecture" requirement with the fewest LLM calls (budget: $9); a 1-revision cap bounds cost and latency.
- Module names are the contract binding the diagram, `agent_info`, and step traces — the grader checks consistency (PDF §2C).
- Serving the SPA from FastAPI satisfies "GUI at root URL" without a second server.
- `/api/execute_lips` is separated from `/api/execute` because the PDF fixes `/api/execute`'s input schema to a JSON `prompt` string, which cannot carry a video.
- espnet/pipelines move (not rewrite) preserves the guarantee that VSR output is unchanged.

## 8. Dependencies & External Integrations

### External Systems
- **EXT-001**: Anthropic API — Claude chat completions for the agent nodes (via `langchain-anthropic`).
- **EXT-002**: Inworld TTS API — voice synthesis with word timestamps (unchanged).

### Infrastructure Dependencies
- **INF-001**: Local VSR weights under `benchmarks/LRS3/` (not in git); ffmpeg on PATH for clip normalization.

### Technology Platform Dependencies
- **PLT-001**: Python ≥3.10 via `uv`; Node ≥18 for the Vite SPA; Windows host.
- **PLT-002**: LangGraph + LangChain (current stable, 2026 API: `StateGraph`, `add_conditional_edges`, `with_structured_output`).

### Compliance Dependencies
- **COM-001**: Privacy invariant — video never persisted; deleted in `finally`; only text leaves the device.

## 9. Examples & Edge Cases

```python
# graph.py — shape (illustrative, not verbatim)
class Review(BaseModel):
    verdict: Literal["approve", "revise"]
    feedback: str

def generate(state: State) -> dict: ...   # llm.with_structured_output(Correction)
def reflect(state: State) -> dict: ...    # llm.with_structured_output(Review)

def route(state: State) -> str:
    return "generate" if state["verdict"] == "revise" and state["revisions"] < 2 else END

g = StateGraph(State)
g.add_node("generate", generate)
g.add_node("reflect", reflect)
g.add_edge(START, "generate")
g.add_edge("generate", "reflect")
g.add_conditional_edges("reflect", route)
agent = g.compile()
```

Edge cases:
- Empty `prompt` in `/api/execute` → error shape, no LLM call.
- Reflect returns `revise` twice → second revise ignored (route sends END after revision 2 of generate).
- No face in clip → friendly message, zero LLM calls.
- LLM/API failure mid-graph → error shape with human-readable message, `steps` of completed calls may be included or empty per REQ-023.
- Missing `app/dist` → root returns a clear "build the SPA" message; `/api/*` unaffected.

## 10. Validation Criteria

1. All acceptance criteria AC-001 … AC-010 pass.
2. `git grep` finds no references to deleted paths (`legacy/`, `chaplin.py`, `brand/`, `configs/`, `test videos`, `SRAVI test videos`) outside docs/history.
3. Steps module names in `/api/execute` responses ⊆ labels present in `assets/architecture.png`.
4. Latency printout within PERF-001/PERF-002 bounds.
5. No secrets in any committed file.

## 11. Related Specifications / Further Reading

- [plan-to-implement.md](../plan-to-implement.md)
- [project_requierments.pdf](../project_requierments.pdf)
- [PRD.md](../PRD.md)
- LangGraph documentation (langchain-ai.github.io/langgraph) — reflection pattern, structured output.
