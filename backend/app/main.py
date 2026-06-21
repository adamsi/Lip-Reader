"""Chaplin AI backend — stateless FastAPI service.

Endpoints (all require a Bearer token except /health):
  POST /transcribe    mp4 clip   -> { "text": <corrected transcription> }
  POST /speak         { text }    -> audio bytes (user's voice)
  GET  /voices                    -> fixed preset voice list
  POST /voice/enroll  mp4 sample  -> { voice_id } (clones + stores on user)
  GET  /me                        -> { voice_id, voice_source }

Privacy: uploaded clips are processed in a temp file and DELETED in a finally
block immediately after inference. Video is never persisted; only text leaves.
"""
from __future__ import annotations

import base64
import logging
import os
import tempfile

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config, db, tts, vsr
from .auth import current_user_id

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("chaplin.api")

app = FastAPI(title="Chaplin AI", version="1.0.0")
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
_DIDNT_CATCH = "Didn't catch that - tap Repeat and try again."


class SpeakBody(BaseModel):
    text: str


class TranscribeResponse(BaseModel):
    text: str


class MeResponse(BaseModel):
    voice_id: str | None
    voice_source: str | None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/me", response_model=MeResponse)
def me(user_id: str = Depends(current_user_id)):
    user = db.get_or_create_user(user_id)
    return MeResponse(voice_id=user.voice_id, voice_source=user.voice_source)


@app.get("/voices")
def voices(user_id: str = Depends(current_user_id)):
    return {"voices": tts.list_voices()}


@app.post("/transcribe", response_model=TranscribeResponse)
def transcribe(file: UploadFile = File(...), user_id: str = Depends(current_user_id)):
    """mp4/webm clip -> corrected transcription. The clip is deleted in `finally`."""
    suffix = ".webm" if (file.content_type or "").endswith("webm") or (
        file.filename or ""
    ).endswith(".webm") else ".mp4"
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(file.file.read())
        try:
            raw = vsr.transcribe_clip(path)
        except (vsr.NoFaceError, vsr.NoSpeechError) as e:
            log.info("no transcription: %s", e)
            return TranscribeResponse(text=_DIDNT_CATCH)
        corrected = vsr.correct_text(raw)
        return TranscribeResponse(text=corrected or _DIDNT_CATCH)
    except Exception as e:  # noqa: BLE001
        log.exception("transcribe failed")
        raise HTTPException(status_code=500, detail=f"transcription failed: {e}")
    finally:
        # PRIVACY: never persist video — delete the clip immediately.
        if os.path.exists(path):
            os.remove(path)


@app.post("/speak")
def speak(body: SpeakBody, user_id: str = Depends(current_user_id)):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    user = db.get_or_create_user(user_id)
    voice_id = user.voice_id or config.DEFAULT_VOICE_ID
    try:
        audio, tokens = tts.synthesize_with_timestamps(text, voice_id)
    except Exception as e:  # noqa: BLE001
        log.exception("speak failed")
        raise HTTPException(status_code=500, detail=f"tts failed: {e}")
    # JSON so we can ship the per-word timestamps alongside the audio.
    return {"audio": base64.b64encode(audio).decode(), "mime": "audio/mpeg", "tokens": tokens}


@app.post("/voice/enroll")
def voice_enroll(file: UploadFile = File(...), user_id: str = Depends(current_user_id)):
    """mp4 voice sample -> clone an Inworld voice, store voice_id on the user."""
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty voice sample")
    # Persist the sample to object-storage-style local dir (S3-swappable).
    sample_path = config.VOICE_STORAGE_DIR / f"{user_id}.mp4"
    try:
        sample_path.write_bytes(data)
        voice_id = tts.enroll_voice(data, display_name=f"voice-{user_id[:8]}")
    except Exception as e:  # noqa: BLE001
        log.exception("voice enroll failed")
        raise HTTPException(status_code=500, detail=f"voice enroll failed: {e}")
    db.set_voice(user_id, voice_id=voice_id, voice_source="uploaded")
    return {"voice_id": voice_id, "voice_source": "uploaded"}


class SelectVoiceBody(BaseModel):
    voice_id: str


@app.post("/voice/select")
def voice_select(body: SelectVoiceBody, user_id: str = Depends(current_user_id)):
    """Pick a voice from the Inworld catalog."""
    if not tts.is_valid_voice(body.voice_id):
        raise HTTPException(status_code=400, detail="unknown voice")
    db.set_voice(user_id, voice_id=body.voice_id, voice_source="preset")
    return {"voice_id": body.voice_id, "voice_source": "preset"}
