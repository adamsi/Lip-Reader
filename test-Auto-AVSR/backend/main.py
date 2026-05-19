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

SUPPORTED_VIDEO_EXTENSIONS = {
    ".mp4",
    ".m4v",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".mpeg",
    ".mpg",
}
CONTENT_TYPE_SUFFIX_MAP = {
    "video/mp4": ".mp4",
    "video/x-m4v": ".m4v",
    "video/quicktime": ".mov",
    "video/x-msvideo": ".avi",
    "video/x-matroska": ".mkv",
    "video/webm": ".webm",
    "video/mpeg": ".mpeg",
}


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


def is_supported_video_upload(file: UploadFile) -> bool:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix in SUPPORTED_VIDEO_EXTENSIONS:
        return True
    return bool(file.content_type and file.content_type.startswith("video/"))


def temp_suffix_for_upload(file: UploadFile) -> str:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix:
        return suffix
    return CONTENT_TYPE_SUFFIX_MAP.get(file.content_type or "", ".mp4")


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")
    if not is_supported_video_upload(file):
        supported = ", ".join(sorted(SUPPORTED_VIDEO_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video format. Supported extensions: {supported}",
        )
    if not Path(CHECKPOINT_PATH).exists():
        raise HTTPException(
            status_code=500,
            detail=f"Checkpoint file not found: {CHECKPOINT_PATH}",
        )

    suffix = temp_suffix_for_upload(file)
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
