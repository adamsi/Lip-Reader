# Plan: Workshop-requirements refactor (folder structure + LangGraph reflection agent + required API/GUI)

## Goals

1. Satisfy the workshop `project_requierments.pdf`: exact API endpoints, steps tracing, GUI at root, architecture PNG, efficient LLM usage.
2. Refactor the simple Claude correction call into a **minimal LangGraph reflection workflow** (generate → reflect → ≤1 revision), following current (2026) LangChain/LangGraph patterns.
3. Clean the repo: one `assets/` folder for loose folders/files, backend code (espnet, pipelines) under `backend/`, delete everything the app doesn't need.
4. Keep lip-reading quality and latency **identical to today** (VSR pipeline untouched) and keep the whole flow low-latency.

## Explicit requirements (from PDF + user)

### API (FastAPI, names must match exactly)
- `GET /api/team_info` → exact JSON with `group_batch_order_number: "1_1"`, `team_name: "Chaplin AI"`, students Adam Sion / Jonathan Eshel (emails as given).
- `GET /api/agent_info` → `description`, `purpose`, `prompt_template.template`, `prompt_examples[]` each with `prompt`, `full_response`, `steps`.
- `GET /api/model_architecture` → PNG image (`Content-Type: image/png`); module names in the diagram must match the `steps` module names exactly.
- `POST /api/execute` → body `{"prompt": "..."}`; response exactly `{status, error, response, steps}`; `steps[]` = every LLM call in order, each `{module, prompt, response}`. Error shape: `{status:"error", error:"...", response:null, steps:[]}`.
- `POST /api/execute_lips` (user-defined) → mp4/webm clip upload → VSR → same agent → same `{status, error, response, steps}` shape.

### LangGraph reflection agent (`backend/app/agent/`)
- `graph.py` — StateGraph: **generate** node (corrects the VSR text; enhanced version of the current `LLM_SYSTEM_PROMPT`) → **reflect** node (critiques) → conditional edge: `revise` (back to generate, **max 1 revision**) or `return` (END). Short, idiomatic, no helper-method sprawl. Graph compiled once at import.
- `prompts.py` — all node prompts, prompt-engineering best practice, few-shot (N-shot) examples where useful.
- `model.py` — `ChatAnthropic` model definition(s), used with **structured output** (Pydantic schemas).
- Steps trace recorded in graph state so the API returns every LLM call with module names matching the architecture diagram (`generate`, `reflect`).
- Efficiency: ≤3 LLM calls worst case (generate, reflect, one revision), temperature 0, small max_tokens, minimal context.

### Frontend (React SPA, `app/`)
- Keep the existing camera **Talk** flow, now calling `POST /api/execute_lips`; show corrected sentence as before (Speak/TTS flow unchanged).
- **Run Agent** button → panel with:
  - dropdown of preset incorrect (VSR-style, all-caps) sentences the agent can correct,
  - free-text textarea (so the professor can type any input),
  - calls `POST /api/execute`, displays final `response` **and the full steps trace** (module / prompt / response, collapsible).
- **About** button → modal with logo, short explanation of the system, architecture, and how to enter input.
- No auth guards; everything smooth, single-page.
- GUI served at the backend root URL `/` (FastAPI serves the built SPA; Vite dev server still works for development).

### Architecture image
- Nice **excalidraw-style** diagram → `assets/architecture.png` (webcam → VSR Pipeline → generate → reflect → response/TTS, with the revise loop). Served by `/api/model_architecture`.

### Folder restructure
- **`assets/`**: `brand/` → `assets/brand/`, `configs/` → `assets/configs/`, `test videos/` → `assets/test_videos/`, `SRAVI test videos/` → `assets/sravi_test_videos/`, `chaplin_ai.pptx` → `assets/chaplin_ai.pptx`, plus new `assets/architecture.png`. All path references updated (backend config, tests, app icons if any).
- **`backend/`**: move `espnet/` → `backend/espnet/`, `pipelines/` → `backend/pipelines/` (still treated as vendored/upstream — imports fixed via the existing sys.path bootstrap in `backend/app/config.py`, code not rewritten).
- `benchmarks/` (gitignored model weights) stays at repo root so weight paths/downloads keep working.

### Deletions (app still works without)
- `legacy/` (old desktop app), `chaplin.py` (prompt moves into `backend/app/agent/prompts.py`), `setup.sh`, `vsr_output.png`, `lipreader.log`, root `__pycache__/`, `.pytest_cache/`.
- `backend/app/auth.py` (imported nowhere) + Clerk env/config leftovers + `@clerk/clerk-react` if unused in the app.
- `app/android/`, `app/ios/` + Capacitor config/deps (web SPA works without the native shells).
- Unused Python deps: `sqlalchemy`, `psycopg2-binary`, `pyjwt`, `sounddevice` (legacy-only). Add `langgraph`, `langchain-anthropic`.
- Build artifacts (`*.tsbuildinfo`) deleted/ignored.
- **Kept**: brand images, `chaplin_ai.pptx`, `README.md`, `PRD.md`, `CLAUDE.md`, `LICENSE`, `tests/`, `backend/e2e_check.py`.

## Inferred requirements

- `steps` for `/api/execute_lips` also includes a `vsr` module entry (the lip-reading step) so the trace tells the whole story; LLM steps use the same module names as `/api/execute`.
- `/api/agent_info` prompt examples are real recorded runs (accurate `full_response` + `steps`).
- Old `/transcribe` endpoint is replaced by `/api/execute_lips`; `/speak`, `/voices`, `/voice/*`, `/health` stay.
- `backend/e2e_check.py` updated to exercise: clip → `/api/execute_lips` → `/api/execute` → `/api/team_info` → `/api/model_architecture` → `/speak`.
- `tests/` updated for moved paths (`assets/sravi_test_videos`) and the new prompt import location.
- README updated to the new structure/endpoints.

## Implementation phases

1. **Checkpoint + restructure** — git checkpoint; move folders (git mv), delete dead files, fix path references (`config.py`, tests, e2e_check), verify VSR still loads and transcribes.
2. **LangGraph agent** — add deps; create `backend/app/agent/{prompts.py, model.py, graph.py}`; unit-smoke it standalone.
3. **API layer** — new `/api/*` endpoints + exact response shapes; serve SPA at root; wire `/api/execute_lips` through VSR + agent; update e2e_check.
4. **Frontend** — api client for new shapes; Run Agent panel (presets dropdown + free text + steps trace); About modal; keep Talk flow intact.
5. **Architecture PNG** — excalidraw-style diagram rendered to `assets/architecture.png`, module names consistent.
6. **Validation & cleanup sweep** — run e2e_check + pytest suite, browser-test every UI flow, latency check, scan for leftover redundant files/code, update README/CLAUDE.md references.

## Acceptance criteria

- All 5 `/api/*` endpoints return exactly the required shapes; error path returns the error shape.
- Reflection loop runs at most 1 revision; `steps` lists every LLM call with module names matching the PNG diagram.
- GUI at root: textarea + Run Agent button + presets, final response and full steps trace visible; Talk (lip-reading) flow works as before; About modal present.
- `uv run python backend/e2e_check.py` → PASS on all stages; `uv run --extra test pytest tests/ -v -s` passes (or skips where hardware/keys missing).
- Lip-reading output quality unchanged (VSR pipeline untouched, same config/weights); `/api/execute` completes in ~2–6 s (2–3 LLM calls).
- No redundant files/folders left; repo root contains only: `app/`, `backend/`, `assets/`, `benchmarks/`, `tests/`, docs, and project config files.

## Testing plan

- `backend/e2e_check.py` (extended) — real request path per stage, PASS/FAIL.
- `pytest tests/` — word-overlap F1 eval suite with updated paths.
- Browser (in-app preview): Run Agent with a preset → response + steps render; free text → response; About modal; Talk → record → sentence → Speak.
- Direct curl checks of each `/api/*` endpoint shape.

## Risks / assumptions

- **Deployment (Vercel/Supabase/Pinecone/LLMod.ai) is out of scope here** — the VSR model can't run on Vercel serverless; this task covers the local app meeting the API/GUI/agent requirements. Flag for later if needed.
- LLM provider stays **Anthropic** (current key/config); LLMod.ai key swap is a config change later if the course requires it.
- Moving `espnet/`/`pipelines/` relies on the sys.path bootstrap — verified by running a real transcription after the move.
- Removing Capacitor (android/ios) drops the native-shell option; the web SPA is unaffected. These folders are deleted per "remove anything the app works without" — say so if you want them kept.
