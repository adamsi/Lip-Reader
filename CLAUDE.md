# CLAUDE.md — Chaplin AI

Guidance for Claude Code in this repo. See [PRD.md](PRD.md) for the product.

**Chaplin AI** helps non-vocal, ventilated patients communicate: it lip-reads them
and speaks the result back in a representative voice. It began as a fork of the
`chaplin` repo (a lip-reading model + LLM corrector) and is evolving into an
**agent** whose job is *reliable* communication — when unsure it asks rather than
asserting a wrong sentence.

## Architecture (high level)
```
webcam ─▶ short mp4 clip ─▶ VSR model (top-1 text + per-word confidence)
                                        │
                                        ▼
                          agent / LLM correction (Claude)
                                        │
                                        ▼
                     on-screen text  +  optional TTS voice clone
```
- API backend: `backend/` (FastAPI). Entry point `backend/app/main.py`.
- React + Capacitor SPA: `app/`. The browser owns the camera (getUserMedia/MediaRecorder).
- Shared LLM correction prompt: `chaplin.py` (`LLM_SYSTEM_PROMPT`, reused by backend + tests).
- VSR model: `pipelines/`
- Vendored model internals: `espnet/` — treat as upstream, avoid editing
- Eval / checks: `tests/`, `backend/e2e_check.py`

## How to work here
- **Scan the relevant files and plan before any large refactor.** For multi-file or
  architectural changes, read the affected code and write a short plan (use plan mode
  or a planning skill), then implement once it's clear.
- **Make the simplest change that works.** Smallest diff, readable code, no speculative abstractions.
- **For agent/LLM work, follow current LangChain / LangGraph docs and 2026 SOTA
  practices** (graph orchestration, native tool-calling, structured outputs). Check the
  official docs rather than relying on memory. Ground the agent in the VSR per-word confidence.
- **After each big refactor, verify all system flows work end to end** before finishing:
  ```powershell
  uv run python backend/e2e_check.py          # clip → /transcribe → /speak, PASS/FAIL per stage
  uv run --extra test pytest tests/ -v -s     # eval suite (word-overlap F1)
  ```
  Report real results; if a flow can't be run here (no camera/API key/weights), say so.

## Conventions
- Windows + **PowerShell** syntax (`$env:VAR`, `$null`). Package manager: **uv**.
- Secrets in `.env` (gitignored): `ANTHROPIC_API_KEY`, optional `INWORLD_API_KEY` / `INWORLD_VOICE_ID`. Never commit secrets.
- Model weights under `benchmarks/LRS3/` and temp `webcam*.mp4` clips are not in git.
- Privacy: video stays local and is deleted after inference; only text leaves the device.
