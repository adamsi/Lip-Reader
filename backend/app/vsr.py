"""VSR inference on top of the vendored Auto-AVSR pipeline (backend/pipelines/)."""
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
    """Returns the raw all-caps transcription; raises NoFaceError/NoSpeechError."""
    model = get_model()
    try:
        text = model(video_path)
    except AssertionError as e:  # mediapipe: no face found
        raise NoFaceError(str(e)) from e
    text = (text or "").strip()
    if not text:
        raise NoSpeechError("empty transcription")
    return text


class NoFaceError(Exception):
    pass


class NoSpeechError(Exception):
    pass
