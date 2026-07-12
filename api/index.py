"""Vercel serverless entrypoint — exposes the FastAPI app (ASGI).

All routes are rewritten here by vercel.json; the SPA itself is served
statically by Vercel from app/dist, so FastAPI only handles the API paths.
"""
import sys
from pathlib import Path

# Make the repo root importable (the function runs from the project root,
# but be explicit so this also works locally: `uvicorn api.index:app`).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.main import app  # noqa: E402,F401
