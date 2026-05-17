import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def resolve_env_path(value: str, default: Path) -> Path:
    if not value:
        return default.resolve()
    path = Path(value)
    if not path.is_absolute():
        path = BASE_DIR / path
    return path.resolve()


AUTO_AVSR_REPO_PATH = resolve_env_path(
    os.getenv("AUTO_AVSR_REPO_PATH", "../auto_avsr"),
    BASE_DIR.parent / "auto_avsr",
)
CHECKPOINT_PATH = str(
    resolve_env_path(
        os.getenv("CHECKPOINT_PATH", "./checkpoints/vsr_trlrs3_base.pth"),
        BASE_DIR / "checkpoints" / "vsr_trlrs3_base.pth",
    )
)
BEAM_SIZE = int(os.getenv("BEAM_SIZE", "5"))
DETECTOR = os.getenv("AUTO_AVSR_DETECTOR", "mediapipe")
INFER_SCRIPT = BASE_DIR / "auto_avsr_infer.py"

app = FastAPI(title="Auto-AVSR Demo")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")
    if not file.filename.lower().endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Only .mp4 files are supported.")
    if not Path(CHECKPOINT_PATH).exists():
        raise HTTPException(
            status_code=500,
            detail=f"Checkpoint file not found: {CHECKPOINT_PATH}",
        )

    suffix = Path(file.filename).suffix or ".mp4"
    temp_path: str | None = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name
            while chunk := await file.read(1024 * 1024):
                temp_file.write(chunk)

        command = [
            sys.executable,
            str(INFER_SCRIPT),
            "--video-path",
            temp_path,
            "--repo-path",
            str(AUTO_AVSR_REPO_PATH),
            "--checkpoint-path",
            CHECKPOINT_PATH,
            "--beam-size",
            str(BEAM_SIZE),
            "--detector",
            DETECTOR,
        ]
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail={
                    "message": "Auto-AVSR inference failed.",
                    "stderr": completed.stderr.strip(),
                    "stdout": completed.stdout.strip(),
                },
            )

        try:
            return json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=500,
                detail={
                    "message": "Inference script returned invalid JSON.",
                    "stdout": completed.stdout.strip(),
                    "stderr": completed.stderr.strip(),
                },
            ) from exc
    finally:
        await file.close()
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
