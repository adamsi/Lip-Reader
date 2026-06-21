"""End-to-end check for the Chaplin AI backend.

Exercises the real request path against the FastAPI app in-process
(FastAPI TestClient), printing PASS/FAIL per stage:

    clip  ->  POST /transcribe  ->  POST /speak

It captures a short webcam clip when a camera is available; otherwise it
falls back to a synthetic clip so the full plumbing (auth, temp-file
handling, the privacy delete-in-finally, error handling) is still verified.

Run:  uv run python backend/e2e_check.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import time

import jwt

# Bootstrap repo-root import path + env.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.app import config  # noqa: E402

CAPTURE_SECONDS = 4
FPS = 16


def step(msg: str) -> None:
    print(f"\n=== {msg} ===", flush=True)


def make_clip() -> tuple[str, str]:
    """Return (path, kind) where kind is 'webcam' or 'synthetic'."""
    import cv2
    import numpy as np

    path = os.path.join(tempfile.gettempdir(), "chaplin_e2e.mp4")
    cap = cv2.VideoCapture(0)
    if cap.isOpened():
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
        writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (w, h), True)
        frames = 0
        deadline = time.time() + CAPTURE_SECONDS
        while time.time() < deadline:
            ok, frame = cap.read()
            if not ok:
                break
            writer.write(frame)
            frames += 1
        cap.release()
        writer.release()
        if frames > 0:
            print(f"captured {frames} webcam frames ({w}x{h})")
            return path, "webcam"
    cap.release()

    # No camera here — synthesize a clip so the path is still exercised.
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (256, 256), True)
    for _ in range(FPS * 2):
        writer.write(np.zeros((256, 256, 3), np.uint8))
    writer.release()
    print("no camera available - using synthetic clip")
    return path, "synthetic"


def main() -> int:
    from fastapi.testclient import TestClient

    from backend.app.main import app

    ok = {"env": False, "transcribe": False, "speak": False}

    step("1/4  Environment")
    print(f"ANTHROPIC_API_KEY: {'set' if config.ANTHROPIC_API_KEY else 'MISSING'}")
    print(f"INWORLD_API_KEY  : {'set' if config.INWORLD_API_KEY else 'MISSING'}")
    weights_ok = os.path.isfile(
        os.path.join(config.REPO_ROOT, "benchmarks/LRS3/models/LRS3_V_WER19.1/model.pth")
    )
    print(f"VSR weights      : {'present' if weights_ok else 'MISSING'}")
    ok["env"] = bool(config.ANTHROPIC_API_KEY and config.INWORLD_API_KEY and weights_ok)

    client = TestClient(app)
    token = jwt.encode({"sub": "e2e_user"}, "e2e-secret-key-padding-padding-xx", algorithm="HS256")
    headers = {"Authorization": f"Bearer {token}"}

    step("2/4  Capture clip")
    clip_path, kind = make_clip()

    step("3/4  POST /transcribe")
    try:
        with open(clip_path, "rb") as f:
            r = client.post("/transcribe", headers=headers, files={"file": ("clip.mp4", f, "video/mp4")})
        if r.status_code == 200:
            text = r.json()["text"]
            ok["transcribe"] = True
            print(f"status           : 200")
            print(f"transcription    : {text!r}")
            if kind == "synthetic":
                print("(synthetic clip -> friendly 'no face' message is expected)")
        else:
            text = "Hello, this is a Chaplin end to end test."
            print(f"status           : {r.status_code} {r.text}")
    finally:
        if os.path.exists(clip_path):
            os.remove(clip_path)

    speak_text = text if ok["transcribe"] and "Didn't catch" not in text else "Hello from Chaplin."

    step("4/4  POST /speak")
    r = client.post("/speak", headers=headers, json={"text": speak_text})
    if r.status_code == 200 and r.json().get("audio"):
        body = r.json()
        ok["speak"] = True
        print(f"status           : 200")
        print(f"audio bytes      : {len(body['audio']) * 3 // 4} (base64 {body.get('mime')})")
        print(f"word timestamps  : {len(body.get('tokens', []))} tokens")
    else:
        print(f"status           : {r.status_code} {r.text}")

    print("\n" + "=" * 44)
    print(" CHAPLIN AI BACKEND E2E")
    print("=" * 44)
    for k in ("env", "transcribe", "speak"):
        print(f"  {k:11s}: {'PASS' if ok[k] else 'FAIL'}")
    allpass = all(ok.values())
    print("=" * 44)
    print(" OVERALL:", "PASS" if allpass else "FAIL")
    return 0 if allpass else 1


if __name__ == "__main__":
    sys.exit(main())
