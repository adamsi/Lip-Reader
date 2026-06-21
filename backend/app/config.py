"""Central config + path bootstrap for the Chaplin AI backend.

Importing this module first makes the repo root importable so the FastAPI
service can reuse the in-place VSR code (``pipelines/``, ``chaplin.py``)
without moving or rewriting it.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# repo root = .../lipreader  (two levels up from this file)
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

load_dotenv(REPO_ROOT / ".env", override=True)

# --- VSR ----------------------------------------------------------------
VSR_CONFIG = os.getenv("VSR_CONFIG", str(REPO_ROOT / "configs" / "LRS3_V_WER19.1.ini"))
VSR_DETECTOR = os.getenv("VSR_DETECTOR", "mediapipe")

# --- LLM ----------------------------------------------------------------
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
LLM_MODEL = "claude-sonnet-4-6"

# --- Inworld TTS --------------------------------------------------------
INWORLD_API_KEY = os.getenv("INWORLD_API_KEY")
DEFAULT_VOICE_ID = os.getenv("INWORLD_VOICE_ID", "Ashley")

# --- Persistence --------------------------------------------------------
# SQLite for the local MVP; set DATABASE_URL to a Postgres DSN to swap.
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{REPO_ROOT / 'backend' / 'chaplin.db'}")
# Object-storage-style local dir for voice samples (S3-swappable later).
VOICE_STORAGE_DIR = Path(os.getenv("VOICE_STORAGE_DIR", str(REPO_ROOT / "backend" / "storage" / "voices")))
VOICE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# --- Auth (Clerk) -------------------------------------------------------
CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL")  # e.g. https://<slug>.clerk.accounts.dev/.well-known/jwks.json
CLERK_ISSUER = os.getenv("CLERK_ISSUER")
# When true (default for MVP) the Bearer token is decoded but not
# cryptographically verified — a documented stub until JWKS is wired.
AUTH_STUB = os.getenv("AUTH_STUB", "true").lower() in ("1", "true", "yes")

# --- CORS ---------------------------------------------------------------
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4173,capacitor://localhost,http://localhost",
).split(",")
