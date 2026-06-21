"""Legacy desktop entry point.

Opens the webcam in an OpenCV window: SPACE to record a clip, SPACE again to
stop and transcribe (VSR -> Claude correction -> printed + optional spoken),
ESC/q to quit.

Run from the repo root (model weights/config paths are resolved from there):
    uv run python legacy/main.py
"""
import os
import sys

# legacy/ is on sys.path[0] when run directly (for chaplin_desktop); add the
# repo root too so `pipelines/` and `configs/` resolve.
LEGACY_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(LEGACY_DIR)
sys.path.insert(0, LEGACY_DIR)
sys.path.append(ROOT)

import torch
from dotenv import load_dotenv

from pipelines.pipeline import InferencePipeline
from chaplin_desktop import Chaplin

load_dotenv(os.path.join(ROOT, ".env"), override=True)

CONFIG = os.path.join(ROOT, "configs", "LRS3_V_WER19.1.ini")


def get_device():
    if torch.cuda.is_available():
        return torch.device("cuda:0")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def main():
    device = get_device()
    print(f"\nUsing device: {device}\n")

    chaplin = Chaplin()
    chaplin.vsr_model = InferencePipeline(
        CONFIG, device=device, detector="mediapipe", face_track=True
    )
    print("\nMODEL LOADED SUCCESSFULLY!\n")

    chaplin.start_webcam()


if __name__ == "__main__":
    main()
