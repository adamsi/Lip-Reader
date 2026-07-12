# Chaplin AI

Chaplin AI helps non-vocal, ventilated patients communicate. The user taps **Talk**,
silently mouths a sentence to the camera, and Chaplin lip-reads it, corrects it with
a LangGraph reflection agent, shows one clean line of text, and — on **Speak** —
voices it back in the user's chosen voice. A **Run Agent** panel also accepts plain
text input (presets or free text), so the agent can be exercised without a camera.

```
webcam clip ─▶ vsr (Auto-AVSR) ─▶ generate ─▶ reflect ─▶ response + steps ─▶ GUI / TTS
                                      ▲           │
                                      └─ revise ──┘  (max 1 loop)
```

## Architecture (monorepo)

| Path        | What it is                                                                 |
|-------------|----------------------------------------------------------------------------|
| `backend/`  | FastAPI service (`backend/app/`) + vendored VSR internals (`backend/pipelines/`, `backend/espnet/` — upstream, not rewritten). |
| `backend/app/agent/` | LangGraph reflection agent: `graph.py` (generate → reflect → revise once), `prompts.py`, `model.py`. |
| `app/`      | React + TypeScript + Vite SPA. The browser owns the camera; the built SPA is served by the backend at `/`. |
| `assets/`   | Brand images, VSR config, test-video ground truths, presentation, `architecture.png`. |
| `tests/`    | Eval suite (word-overlap F1) for the full clip → agent path. |

**Privacy:** uploaded clips are processed in a temp file and deleted in a `finally`
block immediately after inference. Video is never persisted; only text leaves the device.

### API endpoints (no auth)

| Method & path                | Purpose                                                            |
|------------------------------|--------------------------------------------------------------------|
| `GET  /api/team_info`        | student details                                                    |
| `GET  /api/agent_info`       | agent description, purpose, prompt template + real examples        |
| `GET  /api/model_architecture` | architecture diagram (PNG)                                       |
| `POST /api/execute`          | `{ prompt }` → `{ status, error, response, steps }` (text → agent) |
| `POST /api/execute_lips`     | mp4/webm clip → same shape (VSR → agent); steps start with `vsr`   |
| `POST /speak`                | `{ text, voice_id }` → audio + word timestamps (Inworld TTS)       |
| `GET  /voices` · `POST /voice/select` · `POST /voice/enroll` | voice catalog / selection / cloning |
| `GET  /health`               | liveness                                                           |

`steps` lists every model call in order as `{ module, prompt, response }`, with
module names (`vsr`, `generate`, `reflect`) matching `assets/architecture.png`.

## Prerequisites

- Python deps via **uv**; Node 18+ for the SPA.
- VSR weights under `benchmarks/LRS3/` (see paths in `assets/configs/LRS3_V_WER19.1.ini`).
- Secrets in `.env` (gitignored) — copy `.env.example`:
  `ANTHROPIC_API_KEY`, `INWORLD_API_KEY`, optional `INWORLD_VOICE_ID`.

## Run it

```powershell
uv sync
cd app; npm install; npm run build; cd ..   # build the SPA once
uv run uvicorn backend.app.main:app --port 8000
```

Open `http://localhost:8000` — the GUI is served at the root URL. The VSR model
warms up in the background at startup.

For frontend development with hot reload:

```powershell
cd app
npm run dev              # http://localhost:5173 (talks to the backend on :8000)
```

## Brand assets

Logos live in `assets/brand/`; the app's served copies (favicon, app icons) live
in `app/public/`.

## Verification

```powershell
# Backend end-to-end: all /api/* endpoints + clip -> /api/execute_lips -> /speak.
uv run python backend/e2e_check.py

# Eval suite (word-overlap F1) — needs SRAVI test videos present:
uv run --extra test pytest tests/ -v -s
```
