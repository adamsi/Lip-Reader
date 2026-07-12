# Chaplin AI

Chaplin AI helps non-vocal, ventilated patients communicate. The user taps **Talk**,
silently mouths a sentence to the camera, and Chaplin lip-reads it, corrects it with
Claude, shows one clean line of text, and — on **Approve** — speaks it back in the
user's own (or a chosen) voice.

```
webcam clip ─▶ VSR model ─▶ Claude correction ─▶ on-screen text ─▶ (Approve) Inworld TTS
```

## Architecture (monorepo)

| Path        | What it is                                                                 |
|-------------|----------------------------------------------------------------------------|
| `backend/`  | FastAPI service. Wraps the in-place Auto-AVSR pipeline (`pipelines/`) + Claude + Inworld. |
| `app/`      | React + TypeScript + Vite SPA, wrapped with Capacitor for iOS/Android. Same code on web + native. |
| `pipelines/`, `espnet/`, `chaplin.py` | The original VSR model + correction prompt. Reused, **not** rewritten. |
| `legacy/` | Original standalone OpenCV desktop app (`uv run python legacy/main.py`). Kept for reference. |

**Privacy:** uploaded clips are processed in a temp file and deleted in a `finally`
block immediately after inference. Video is never persisted; only text leaves the device.

### Backend endpoints (all require a Bearer token except `/health`)

| Method & path        | Purpose                                                        |
|----------------------|----------------------------------------------------------------|
| `POST /transcribe`   | mp4/webm clip → `{ "text": <corrected transcription> }`        |
| `POST /speak`        | `{ text }` → audio bytes (Inworld TTS in the user's voice)     |
| `GET  /voices`       | fixed preset voice list                                        |
| `POST /voice/select` | `{ voice_id }` → save a preset choice                          |
| `POST /voice/enroll` | mp4 voice sample → clone an Inworld voice, store it on the user |
| `GET  /me`           | `{ voice_id, voice_source }` (onboarding state)                |
| `GET  /health`       | liveness                                                       |

## Prerequisites

- Python deps via **uv**; Node 18+ for the SPA.
- VSR weights under `benchmarks/LRS3/` (see paths in `configs/LRS3_V_WER19.1.ini`).
- Secrets in `.env` (gitignored) — copy `.env.example`:
  `ANTHROPIC_API_KEY`, `INWORLD_API_KEY`, optional `INWORLD_VOICE_ID`.

## 1. Run the backend

```powershell
uv sync
uv run uvicorn backend.app.main:app --reload --port 8000
```

- Serves on `http://localhost:8000`. The heavy VSR model loads lazily on the first
  `/transcribe` call.
- No auth: the API is open on localhost.
- Persistence: none — the selected voice lives in the browser's localStorage.
  Voice samples are stored under `backend/storage/voices/`.

## 2. Run the SPA (web)

```powershell
cd app
npm install
copy .env.example .env   # then set VITE_CLERK_PUBLISHABLE_KEY + VITE_API_BASE
npm run dev              # http://localhost:5173
```

Flow: Clerk sign-in → onboarding (pick a preset voice **or** record/upload a voice
sample) → **Talk** screen → record → corrected text → **Approve** (speaks it) / **Repeat**.

## 3. Capacitor build (iOS / Android)

```powershell
cd app
npm run build            # produces app/dist
npx cap sync             # copies the web build into the native projects

# Android (needs Android Studio / SDK):
npx cap open android

# iOS (needs macOS + Xcode + CocoaPods):
npx cap open ios
```

The native projects live in `app/android/` and `app/ios/` (generated; gitignored).
> iOS native builds require macOS/Xcode — they cannot be produced on Windows.

## Brand assets

Logos live in `brand/`:

- `chaplin_logo_with_text_white_background.png` — original master artwork
- `chaplin_logo_with_text.png` — logo + text, transparent
- `chaplin_logo_icon.png` — icon only, transparent
- `social_preview.png` — 1280×640; upload under Repo → Settings → General → Social preview

The app's served copies (favicon, app icons, splash) live in `app/public/` and `app/assets/`.

## Verification

```powershell
# Backend end-to-end: clip -> /transcribe -> /speak, PASS/FAIL per stage.
uv run python backend/e2e_check.py

# Eval suite (word-overlap F1) — needs SRAVI test videos present:
uv run --extra test pytest tests/ -v -s
```
