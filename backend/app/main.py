"""Chaplin AI backend — stateless FastAPI service.

No auth and no DB: the app is open on localhost and the selected voice
persists in the browser's localStorage, arriving with each /speak request.

Endpoints:
  POST /transcribe    mp4 clip           -> { "text": <corrected transcription> }
  POST /speak         { text, voice_id }  -> audio bytes + word timestamps
  GET  /voices                            -> fixed preset voice list
  POST /voice/enroll  mp4 sample          -> { voice_id } (clones a voice)
  POST /voice/select  { voice_id }        -> validates against the catalog

Privacy: uploaded clips are processed in a temp file and DELETED in a finally
block immediately after inference. Video is never persisted; only text leaves.
"""
from __future__ import annotations

import base64
import logging
import os
import subprocess
import tempfile
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config, tts, vsr

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("chaplin.api")

@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Warm the VSR model in the background at startup (instead of lazily on
    # the first /transcribe) so the first request doesn't pay the ~20s load.
    # get_model() is a locked singleton, so a concurrent request just waits.
    threading.Thread(target=vsr.get_model, daemon=True).start()
    yield


app = FastAPI(title="Chaplin AI", version="1.0.0", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    # Allow any localhost port (Vite may use 5174+ if 5173 is taken) + capacitor.
    allow_origin_regex=r"^(https?://localhost(:\d+)?|capacitor://localhost)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Friendly message shown when we can't read a clip (no face / no speech).
_DIDNT_CATCH = "I didn't catch that. Please try again."


def _normalize_clip(src: str) -> str:
    """Re-encode a browser clip to 16fps h264 mp4 before inference.

    Browser MediaRecorder clips are ~30fps VP9 webm; the VSR pipeline's cost
    scales superlinearly with frame count, so normalizing to 16fps (what the
    legacy desktop app recorded) keeps latency at desktop levels. Returns the
    new path, or ``src`` unchanged if ffmpeg is unavailable/fails.
    """
    dst = src + ".norm.mp4"
    try:
        proc = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", src,
             "-vf", "fps=16", "-an", "-c:v", "libx264", "-preset", "ultrafast", dst],
            capture_output=True, timeout=60,
        )
        if proc.returncode == 0 and os.path.getsize(dst) > 0:
            return dst
        log.warning("clip normalization failed, using original: %s", proc.stderr.decode(errors="replace"))
    except (OSError, subprocess.TimeoutExpired) as e:
        log.warning("ffmpeg unavailable, using original clip: %s", e)
    if os.path.exists(dst):
        os.remove(dst)
    return src


class SpeakBody(BaseModel):
    text: str
    voice_id: str | None = None


class TranscribeResponse(BaseModel):
    text: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/voices")
def voices():
    return {"voices": tts.list_voices()}


@app.post("/transcribe", response_model=TranscribeResponse)
def transcribe(file: UploadFile = File(...)):
    """mp4/webm clip -> corrected transcription. The clip is deleted in `finally`."""
    suffix = ".webm" if (file.content_type or "").endswith("webm") or (
        file.filename or ""
    ).endswith(".webm") else ".mp4"
    fd, path = tempfile.mkstemp(suffix=suffix)
    norm_path = path
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(file.file.read())
        norm_path = _normalize_clip(path)
        try:
            raw = vsr.transcribe_clip(norm_path)
        except (vsr.NoFaceError, vsr.NoSpeechError) as e:
            log.info("no transcription: %s", e)
            return TranscribeResponse(text=_DIDNT_CATCH)
        corrected = vsr.correct_text(raw)
        return TranscribeResponse(text=corrected or _DIDNT_CATCH)
    except Exception as e:  # noqa: BLE001
        log.exception("transcribe failed")
        raise HTTPException(status_code=500, detail=f"transcription failed: {e}")
    finally:
        # PRIVACY: never persist video — delete the clip(s) immediately.
        for p in {path, norm_path}:
            if os.path.exists(p):
                os.remove(p)


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
    # Persist the sample to object-storage-style local dir (S3-swappable).
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
