"""End-to-end check for the Chaplin AI services.

Exercises the real request path against both FastAPI apps in-process
(FastAPI TestClient), printing PASS/FAIL per stage:

  API backend (backend/app/main.py — Vercel in production):
    GET  /api/team_info
    GET  /api/agent_info
    GET  /api/model_architecture
    POST /api/execute        (text prompt -> agent)
    POST /speak

  vsr_lip_reader service (backend/app/vsr_main.py — Modal in production):
    POST /api/execute_lips   (clip -> VSR -> agent)

It captures a short webcam clip when a camera is available; otherwise it
falls back to a synthetic clip so the full plumbing (temp-file handling,
the privacy delete-in-finally, error handling) is still verified.

Run:  uv run python backend/e2e_check.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import time

# Bootstrap repo-root import path + env.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.app import config  # noqa: E402

CAPTURE_SECONDS = 4
FPS = 16
EXECUTE_PROMPT = "IM SO EXCITED TO ME YOU TODAY"


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
    from backend.app.vsr_main import app as vsr_app

    ok = {"env": False, "team_info": False, "agent_info": False,
          "architecture": False, "execute": False, "execute_lips": False,
          "speak": False}

    step("1/7  Environment")
    print(f"ANTHROPIC_API_KEY: {'set' if config.ANTHROPIC_API_KEY else 'MISSING'}")
    print(f"INWORLD_API_KEY  : {'set' if config.INWORLD_API_KEY else 'MISSING'}")
    weights_ok = os.path.isfile(
        os.path.join(config.REPO_ROOT, "benchmarks/LRS3/models/LRS3_V_WER19.1/model.pth")
    )
    print(f"VSR weights      : {'present' if weights_ok else 'MISSING'}")
    ok["env"] = bool(config.ANTHROPIC_API_KEY and config.INWORLD_API_KEY and weights_ok)

    client = TestClient(app)

    step("2/7  GET /api/team_info")
    r = client.get("/api/team_info")
    body = r.json() if r.status_code == 200 else {}
    ok["team_info"] = (
        r.status_code == 200
        and body.get("group_batch_order_number") == "1_1"
        and body.get("team_name") == "Chaplin AI"
        and len(body.get("students", [])) == 2
    )
    print(f"status: {r.status_code}  team: {body.get('team_name')!r}  students: {len(body.get('students', []))}")

    step("3/7  GET /api/agent_info")
    r = client.get("/api/agent_info")
    body = r.json() if r.status_code == 200 else {}
    ok["agent_info"] = (
        r.status_code == 200
        and all(k in body for k in ("description", "purpose", "prompt_template", "prompt_examples"))
        and "template" in body["prompt_template"]
        and all(k in body["prompt_examples"][0] for k in ("prompt", "full_response", "steps"))
    )
    print(f"status: {r.status_code}  keys: {sorted(body.keys())}")

    step("4/7  GET /api/model_architecture")
    r = client.get("/api/model_architecture")
    ok["architecture"] = r.status_code == 200 and r.headers.get("content-type", "").startswith("image/png")
    print(f"status: {r.status_code}  content-type: {r.headers.get('content-type')}  bytes: {len(r.content)}")

    step("5/7  POST /api/execute")
    t0 = time.time()
    r = client.post("/api/execute", json={"prompt": EXECUTE_PROMPT})
    dt = time.time() - t0
    body = r.json() if r.status_code == 200 else {}
    steps_ok = (
        body.get("steps")
        and all({"module", "prompt", "response"} <= set(s) for s in body["steps"])
        and {s["module"] for s in body["steps"]} <= {"generate", "reflect"}
    )
    ok["execute"] = r.status_code == 200 and body.get("status") == "ok" and bool(body.get("response")) and bool(steps_ok)
    print(f"status: {r.status_code}  latency: {dt:.1f}s")
    print(f"prompt   : {EXECUTE_PROMPT!r}")
    print(f"response : {body.get('response')!r}")
    print(f"steps    : {[s['module'] for s in body.get('steps', [])]}")
    # error shape check (no LLM call)
    r = client.post("/api/execute", json={"prompt": ""})
    err = r.json()
    if not (err.get("status") == "error" and err.get("response") is None and err.get("steps") == []):
        ok["execute"] = False
        print("ERROR-shape check failed:", err)

    step("6/7  POST /api/execute_lips (vsr_lip_reader service)")
    vsr_client = TestClient(vsr_app)
    clip_path, kind = make_clip()
    speak_text = "Hello from Chaplin."
    try:
        t0 = time.time()
        with open(clip_path, "rb") as f:
            r = vsr_client.post("/api/execute_lips", files={"file": ("clip.mp4", f, "video/mp4")})
        dt = time.time() - t0
        body = r.json() if r.status_code == 200 else {}
        print(f"status: {r.status_code}  latency: {dt:.1f}s  clip: {kind}")
        if body.get("status") == "ok":
            steps = body.get("steps", [])
            ok["execute_lips"] = (
                bool(body.get("response"))
                and steps and steps[0]["module"] == "vsr"
                and all({"module", "prompt", "response"} <= set(s) for s in steps)
            )
            print(f"response : {body.get('response')!r}")
            print(f"steps    : {[s['module'] for s in steps]}")
            speak_text = body.get("response") or speak_text
        else:
            # No face / no speech -> the error shape is the correct outcome
            # (synthetic clips always; webcam clips when nobody is speaking).
            shape_ok = body.get("response") is None and body.get("steps") == [] and body.get("error")
            ok["execute_lips"] = bool(shape_ok)
            print(f"error    : {body.get('error')!r} (valid error shape - no face/speech in clip)")
    finally:
        if os.path.exists(clip_path):
            os.remove(clip_path)

    step("7/7  POST /speak")
    r = client.post("/speak", json={"text": speak_text})
    if r.status_code == 200 and r.json().get("audio"):
        body = r.json()
        ok["speak"] = True
        print(f"status: 200  audio bytes: {len(body['audio']) * 3 // 4}  word timestamps: {len(body.get('tokens', []))}")
    else:
        print(f"status: {r.status_code} {r.text[:200]}")

    print("\n" + "=" * 44)
    print(" CHAPLIN AI BACKEND E2E")
    print("=" * 44)
    for k, v in ok.items():
        print(f"  {k:13s}: {'PASS' if v else 'FAIL'}")
    allpass = all(ok.values())
    print("=" * 44)
    print(" OVERALL:", "PASS" if allpass else "FAIL")
    return 0 if allpass else 1


if __name__ == "__main__":
    sys.exit(main())
