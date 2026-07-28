"""Deploy the full Chaplin AI backend (FastAPI + VSR on GPU) to Modal.

One-time setup:
  uv run modal setup                                          # link account
  uv run modal volume create chaplin-weights
  uv run modal volume put chaplin-weights benchmarks/LRS3 /LRS3
  # In the Modal dashboard, create a secret named `chaplin-secrets` with
  # ANTHROPIC_API_KEY (and optionally INWORLD_API_KEY / INWORLD_VOICE_ID).

Deploy (repeat after backend changes):
  uv run modal deploy modal_app.py

Then set VITE_API_BASE on Vercel to the printed .modal.run URL.
"""
import modal

REMOTE_ROOT = "/root/chaplin"

image = (
    modal.Image.debian_slim(python_version="3.12")
    # ffmpeg for clip normalization; libgl/libglib for opencv + mediapipe.
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "opencv-python>=4.5.5.62",
        "scipy>=1.3.0",
        "scikit-image>=0.13.0",
        "av>=10.0.0",
        "six>=1.16.0",
        "mediapipe==0.10.21",
        # Pinned to a known-good stable CUDA build: local dev only ever runs
        # torch CPU-only, so the GPU path here was never exercised before
        # deploying — an unpinned "latest" torch risks a T4/driver mismatch.
        "torch==2.5.1",
        "torchvision==0.20.1",
        "torchaudio==2.5.1",
        "transformers==4.44.2",
        "anthropic",
        "langgraph",
        "langchain-anthropic",
        "python-dotenv",
        "inworld-tts",
        "fastapi",
        "uvicorn[standard]",
        "python-multipart",
        "httpx",
    )
    .env(
        {
            "DISABLE_VSR": "0",
            "CORS_ORIGINS": (
                "https://chaplin-ai.vercel.app,"
                "http://localhost:5173,http://localhost:4173"
            ),
            # Surface a real Python/C++ traceback instead of a bare SIGABRT
            # if a CUDA op fails on the T4.
            "CUDA_LAUNCH_BLOCKING": "1",
            "TORCH_SHOW_CPP_STACKTRACES": "1",
        }
    )
    # The INI weight paths (benchmarks/LRS3/...) are relative to the CWD.
    .workdir(REMOTE_ROOT)
    .add_local_dir("backend", remote_path=f"{REMOTE_ROOT}/backend",
                   ignore=["**/__pycache__", "storage"])
    .add_local_dir("assets", remote_path=f"{REMOTE_ROOT}/assets")
)

weights = modal.Volume.from_name("chaplin-weights")

app = modal.App("chaplin-ai")


@app.function(
    image=image,
    gpu="T4",
    # Volume holds /LRS3, so mounting at ./benchmarks yields benchmarks/LRS3.
    volumes={f"{REMOTE_ROOT}/benchmarks": weights},
    secrets=[modal.Secret.from_name("chaplin-secrets")],
    timeout=600,
    scaledown_window=300,
    memory=8192,
)
@modal.asgi_app()
def backend():
    import os
    import sys

    os.chdir(REMOTE_ROOT)
    sys.path.insert(0, REMOTE_ROOT)
    from backend.app.main import app as fastapi_app

    return fastapi_app
