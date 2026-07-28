"""Chaplin AI backend — stateless FastAPI service (no VSR).

Workshop API (exact shapes required by the course PDF):
  GET  /api/team_info           -> student details
  GET  /api/agent_info          -> agent meta, prompt template + examples
  GET  /api/model_architecture  -> architecture diagram (PNG)
  POST /api/execute             { prompt } -> { status, error, response, steps }

Supporting endpoints (unchanged): /health, /voices, /voice/*, /speak.
The built SPA (app/dist) is served at the root URL when present.

Lip-reading (POST /api/execute_lips) lives in the separate vsr_lip_reader
service (``backend/app/vsr_main.py``), deployed on Modal with a GPU — this
service has no torch/VSR dependency so it can run on Vercel serverless.
"""
from __future__ import annotations

import base64
import logging

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, meta, tts
from .agent import run_agent

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("chaplin.api")


app = FastAPI(title="Chaplin AI", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    # Allow any localhost port (Vite may use 5174+ if 5173 is taken).
    allow_origin_regex=r"^https?://localhost(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ARCHITECTURE_PNG = config.REPO_ROOT / "assets" / "architecture.png"
SPA_DIST = config.REPO_ROOT / "app" / "dist"


def _ok(response: str, steps: list[dict]) -> dict:
    return {"status": "ok", "error": None, "response": response, "steps": steps}


def _err(message: str) -> dict:
    return {"status": "error", "error": message, "response": None, "steps": []}


# --- workshop API ---------------------------------------------------------

@app.get("/api/team_info")
def team_info():
    return meta.TEAM_INFO


@app.get("/api/agent_info")
def agent_info():
    return meta.AGENT_INFO


@app.get("/api/model_architecture")
def model_architecture():
    if not ARCHITECTURE_PNG.is_file():
        raise HTTPException(status_code=404, detail="architecture.png not found")
    return FileResponse(ARCHITECTURE_PNG, media_type="image/png")


class ExecuteBody(BaseModel):
    prompt: str = ""


@app.post("/api/execute")
def execute(body: ExecuteBody):
    """Text prompt (a raw/noisy transcription) -> corrected sentence + steps."""
    text = (body.prompt or "").strip()
    if not text:
        return _err("prompt is required")
    try:
        result = run_agent(text)
    except Exception as e:  # noqa: BLE001
        log.exception("agent failed")
        return _err(f"agent failed: {e}")
    return _ok(result["response"], result["steps"])


# --- supporting endpoints (unchanged contracts) ----------------------------

class SpeakBody(BaseModel):
    text: str
    voice_id: str | None = None


@app.get("/health")
def health():
    # This service never runs the VSR model — the SPA asks the vsr_lip_reader
    # service's /health for lip-reading availability.
    return {"status": "ok", "vsr_available": False}


@app.get("/voices")
def voices():
    return {"voices": tts.list_voices()}


@app.post("/speak")
def speak(body: SpeakBody):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    voice_id = body.voice_id or config.DEFAULT_VOICE_ID
    try:
        audio, tokens = tts.synthesize_with_timestamps(text, voice_id)
    except Exception as e:  # noqa: BLE001
        log.exception("speak failed")
        raise HTTPException(status_code=500, detail=f"tts failed: {e}")
    # JSON so we can ship the per-word timestamps alongside the audio.
    return {"audio": base64.b64encode(audio).decode(), "mime": "audio/mpeg", "tokens": tokens}


@app.post("/voice/enroll")
def voice_enroll(file: UploadFile = File(...)):
    """mp4 voice sample -> clone an Inworld voice; the client stores the id."""
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty voice sample")
    sample_path = config.VOICE_STORAGE_DIR / "local.mp4"
    try:
        sample_path.write_bytes(data)
        voice_id = tts.enroll_voice(data, display_name="voice-local")
    except Exception as e:  # noqa: BLE001
        log.exception("voice enroll failed")
        raise HTTPException(status_code=500, detail=f"voice enroll failed: {e}")
    return {"voice_id": voice_id, "voice_source": "uploaded"}


class SelectVoiceBody(BaseModel):
    voice_id: str


@app.post("/voice/select")
def voice_select(body: SelectVoiceBody):
    """Validate a voice from the Inworld catalog; the client stores the id."""
    if not tts.is_valid_voice(body.voice_id):
        raise HTTPException(status_code=400, detail="unknown voice")
    return {"voice_id": body.voice_id, "voice_source": "preset"}


# --- SPA at the root URL ----------------------------------------------------
# Mounted last: explicit routes above always win; everything else serves the
# built React app (GUI requirement: available on the root url, no auth).
if SPA_DIST.is_dir():
    app.mount("/", StaticFiles(directory=SPA_DIST, html=True), name="spa")
else:
    @app.get("/")
    def root():
        return {"detail": "SPA not built - run `npm run build` in app/ (dev server: npm run dev)"}
