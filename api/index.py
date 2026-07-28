"""Vercel serverless entry point for the Chaplin AI API backend.

Vercel routes every backend path here (see vercel.json rewrites); the ASGI
app receives the original request path, so the FastAPI routes in
backend/app/main.py work unchanged. The VSR-heavy /api/execute_lips endpoint
is NOT here — it lives in the vsr_lip_reader service on Modal.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app.main import app  # noqa: E402,F401
