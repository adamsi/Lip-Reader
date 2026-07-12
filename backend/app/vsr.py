"""VSR inference.

Reuses the vendored Auto-AVSR pipeline (``backend/pipelines/``) — the model
is not rewritten here. The heavy model is loaded lazily on first transcribe
and kept as a singleton. Correction of the raw output is the job of the
LangGraph agent (``backend/app/agent/``).
"""
from __future__ import annotations

import logging
import threading

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


class NoFaceError(Exception):
    """The face detector found no face in the clip."""


class NoSpeechError(Exception):
    """The model produced no usable transcription."""
