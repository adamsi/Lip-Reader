"""VSR inference + Claude correction.

Reuses the in-place Auto-AVSR pipeline (``pipelines/``) and the existing
``LLM_SYSTEM_PROMPT`` from ``chaplin.py`` — the model is not rewritten here.
The heavy model is loaded lazily on first transcribe and kept as a singleton.
"""
from __future__ import annotations

import json
import logging
import threading

import anthropic

from . import config
from .config import REPO_ROOT  # noqa: F401  (ensures sys.path bootstrap ran)

log = logging.getLogger("chaplin.vsr")

_model = None
_model_lock = threading.Lock()


def _get_device():
    import torch

    if torch.cuda.is_available():
        return torch.device("cuda:0")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def get_model():
    """Lazily load the Auto-AVSR InferencePipeline (thread-safe singleton)."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from pipelines.pipeline import InferencePipeline

                device = _get_device()
                log.info("Loading VSR model on %s ...", device)
                _model = InferencePipeline(
                    config.VSR_CONFIG,
                    device=device,
                    detector=config.VSR_DETECTOR,
                    face_track=True,
                )
                log.info("VSR model loaded.")
    return _model


def transcribe_clip(video_path: str) -> str:
    """Run lip-reading on an mp4 clip. Returns raw (all-caps) transcription.

    Raises ``NoSpeechError`` when the model produced nothing usable and
    ``NoFaceError`` when the face detector found no face to read.
    """
    model = get_model()
    try:
        text = model(video_path)
    except AssertionError as e:
        # mediapipe raises AssertionError when it finds no face in the clip.
        raise NoFaceError(str(e)) from e
    text = (text or "").strip()
    if not text:
        raise NoSpeechError("empty transcription")
    return text


# Single source of truth for the correction prompt: reuse chaplin's.
from chaplin import LLM_SYSTEM_PROMPT  # noqa: E402

_client = anthropic.Anthropic() if config.ANTHROPIC_API_KEY else None


def correct_text(raw: str) -> str:
    """Send the raw transcription to Claude for correction. Returns clean text."""
    if _client is None:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")
    resp = _client.messages.create(
        model=config.LLM_MODEL,
        max_tokens=1024,
        system=LLM_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Transcription:\n\n{raw}"}],
        output_config={
            "format": {
                "type": "json_schema",
                "schema": {
                    "type": "object",
                    "properties": {"corrected": {"type": "string"}},
                    "required": ["corrected"],
                    "additionalProperties": False,
                },
            }
        },
    )
    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), "")
    try:
        corrected = json.loads(text).get("corrected", "").strip()
    except (json.JSONDecodeError, AttributeError):
        corrected = text.strip()
    if corrected and corrected[-1] not in ".?!":
        corrected += "."
    return corrected


class NoFaceError(Exception):
    """The face detector found no face in the clip."""


class NoSpeechError(Exception):
    """The model produced no usable transcription."""
