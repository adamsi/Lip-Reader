"""Chaplin AI API backend. Lip reading is served separately by vsr_main.py."""
from __future__ import annotations

import base64
import logging
from typing import Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, db, meta, tts
from .agent import run_agent

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("chaplin.api")


app = FastAPI(title="Chaplin AI", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
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


class ConversationMessage(BaseModel):
    role: Literal["self", "other"]
    content: str


class ExecuteBody(BaseModel):
    prompt: str = ""
    conversation: list[ConversationMessage] = []


@app.post("/api/execute")
def execute(body: ExecuteBody):
    text = (body.prompt or "").strip()
    if not text:
        return _err("prompt is required")
    try:
        result = run_agent(text, [m.model_dump() for m in body.conversation])
    except Exception as e:  # noqa: BLE001
        log.exception("agent failed")
        return _err(f"agent failed: {e}")
    return _ok(result["response"], result["steps"])


# --- chat store (Supabase Postgres, sigma-agent-server shape) ---------------

class CreateChatBody(BaseModel):
    title: str = "New chat"


class AppendMessageBody(BaseModel):
    role: Literal["self", "other"]
    content: str
    steps: list[dict] | None = None


@app.get("/api/chats")
def chats_list():
    try:
        return {"conversations": db.list_conversations()}
    except Exception as e:  # noqa: BLE001
        log.exception("list chats failed")
        raise HTTPException(status_code=503, detail=f"chat store unavailable: {e}")


@app.post("/api/chats")
def chats_create(body: CreateChatBody):
    try:
        return db.create_conversation((body.title or "New chat").strip()[:256])
    except Exception as e:  # noqa: BLE001
        log.exception("create chat failed")
        raise HTTPException(status_code=503, detail=f"chat store unavailable: {e}")


@app.delete("/api/chats/{chat_id}")
def chats_delete(chat_id: str):
    try:
        found = db.delete_conversation(chat_id)
        if not found and db.is_preset(chat_id):
            raise HTTPException(status_code=403, detail="preset chats cannot be deleted")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        log.exception("delete chat failed")
        raise HTTPException(status_code=503, detail=f"chat store unavailable: {e}")
    if not found:
        raise HTTPException(status_code=404, detail="chat not found")
    return {"deleted": chat_id}


@app.get("/api/chats/{chat_id}/messages")
def chats_messages(chat_id: str):
    try:
        return {"messages": db.get_messages(chat_id)}
    except Exception as e:  # noqa: BLE001
        log.exception("get messages failed")
        raise HTTPException(status_code=503, detail=f"chat store unavailable: {e}")


@app.post("/api/chats/{chat_id}/messages")
def chats_append(chat_id: str, body: AppendMessageBody):
    text = body.content.strip()
    if not text:
        raise HTTPException(status_code=400, detail="content is required")
    try:
        msg = db.append_message(chat_id, body.role, text, body.steps)
        if msg is None and db.is_preset(chat_id):
            raise HTTPException(status_code=403, detail="preset chats are read-only")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        log.exception("append message failed")
        raise HTTPException(status_code=503, detail=f"chat store unavailable: {e}")
    if msg is None:
        raise HTTPException(status_code=404, detail="chat not found")
    return msg


@app.get("/api/db_ping")
def db_ping():
    """Keep-alive: a scheduled job hits this so the Supabase project never pauses."""
    try:
        db.ping()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"db unreachable: {e}")
    return {"status": "ok", "db": 1}


# --- supporting endpoints (unchanged contracts) ----------------------------

class SpeakBody(BaseModel):
    text: str
    voice_id: str | None = None


@app.get("/health")
def health():
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
    return {"audio": base64.b64encode(audio).decode(), "mime": "audio/mpeg", "tokens": tokens}


@app.post("/voice/enroll")
def voice_enroll(file: UploadFile = File(...)):
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
    if not tts.is_valid_voice(body.voice_id):
        raise HTTPException(status_code=400, detail="unknown voice")
    return {"voice_id": body.voice_id, "voice_source": "preset"}


# Mounted last so the explicit routes above win.
if SPA_DIST.is_dir():
    app.mount("/", StaticFiles(directory=SPA_DIST, html=True), name="spa")
else:
    @app.get("/")
    def root():
        return {"detail": "SPA not built - run `npm run build` in app/ (dev server: npm run dev)"}
