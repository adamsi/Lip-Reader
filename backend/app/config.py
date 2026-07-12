"""Central config + path bootstrap for the Chaplin AI backend.

Importing this module first makes ``backend/`` importable so the FastAPI
service can reuse the vendored VSR code (``backend/pipelines/``,
``backend/espnet/``) without rewriting its ``pipelines.*``/``espnet.*``
imports.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# repo root = .../lipreader  (two levels up from this file)
REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
for p in (str(REPO_ROOT), str(BACKEND_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

load_dotenv(REPO_ROOT / ".env", override=True)

# --- VSR ----------------------------------------------------------------
VSR_CONFIG = os.getenv("VSR_CONFIG", str(REPO_ROOT / "assets" / "configs" / "LRS3_V_WER19.1.ini"))
VSR_DETECTOR = os.getenv("VSR_DETECTOR", "mediapipe")

# --- LLM ----------------------------------------------------------------
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
LLM_MODEL = "claude-sonnet-4-6"

# --- Inworld TTS --------------------------------------------------------
INWORLD_API_KEY = os.getenv("INWORLD_API_KEY")
DEFAULT_VOICE_ID = os.getenv("INWORLD_VOICE_ID", "Ashley")

# --- Persistence --------------------------------------------------------
# No DB: the selected voice lives in the browser's localStorage.
# Object-storage-style local dir for voice samples (S3-swappable later).
VOICE_STORAGE_DIR = Path(os.getenv("VOICE_STORAGE_DIR", str(REPO_ROOT / "backend" / "storage" / "voices")))
VOICE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# --- CORS ---------------------------------------------------------------
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4173,http://localhost",
).split(",")
