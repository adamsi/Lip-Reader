# Auto-AVSR Local Demo

This demo has:

- `backend/main.py`: FastAPI server with `POST /transcribe`
- `backend/auto_avsr_infer.py`: subprocess target that runs real Auto-AVSR inference on a single uploaded MP4
- `frontend/`: React + TypeScript + Vite upload UI
- `backend/.env`: backend config
- `frontend/.env`: frontend API URL config

## 1. Clone Auto-AVSR

From the project root:

```powershell
git clone https://github.com/mpc001/auto_avsr.git ./auto_avsr
```

## 2. Create a Python virtual environment

From the project root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
```

## 3. Install backend requirements

Install the FastAPI server dependencies:

```powershell
pip install -r backend\requirements.txt
```

Install Auto-AVSR runtime dependencies. The repository README currently lists `torch`, `torchvision`, `torchaudio`, `pytorch-lightning`, `sentencepiece`, and `av`, and the preprocessing README adds `opencv-python`, `ffmpeg-python`, and `scikit-image`. For lip-reading on a raw MP4, you also need a face detector. This demo defaults to `mediapipe` because it is simpler than RetinaFace for a local CPU setup:

```powershell
pip install torch torchvision torchaudio pytorch-lightning sentencepiece av
pip install -r auto_avsr\preparation\requirements.txt
pip install mediapipe
```

If you want to try RetinaFace instead of MediaPipe:

```powershell
cd auto_avsr\preparation\tools
pip install -r requirements.txt
cd ..\..\..
```

## 4. Download and place a checkpoint

Auto-AVSR checkpoints are documented in the repository model zoo. For visual speech recognition, the tutorial uses:

- `vsr_trlrs3_base.pth`

The tutorial notebook in `auto_avsr/tutorials/inference.ipynb` downloads that checkpoint from:

- `https://drive.google.com/file/d/1V7kMt7bYG0ripou_6QvZIAG_fwbQw2Td/view?usp=drive_link`

Download it and place it at:

```text
C:\Users\adams\Desktop\Projects\Lip-Reader\test-Auto-AVSR\backend\checkpoints\vsr_trlrs3_base.pth
```

That matches the default `CHECKPOINT_PATH` already set in `backend/.env`, so you do not need to edit environment variables if you use that location.

## 5. Run FastAPI

From the project root, with the virtualenv still activated:

```powershell
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

The backend automatically loads `backend/.env`.

The API endpoint is:

- `POST http://localhost:8000/transcribe`

It expects multipart form data with a file field named `file`.

## 6. Install and run React

From the project root:

```powershell
cd frontend
npm install
npm run dev
```

The frontend automatically loads `frontend/.env`, which points the upload form to `http://localhost:8000/transcribe`.

Open the local Vite URL shown in the terminal, typically:

- `http://localhost:5173`

## Notes

- The backend uses `subprocess` to invoke `backend/auto_avsr_infer.py`, which keeps Auto-AVSR isolated from the FastAPI app.
- `backend/auto_avsr_infer.py` is already inside `backend/`; there is no separate package to install for that helper.
- This demo uses the real Auto-AVSR model and its beam search decoder. It does not fake inference.
- The `score` values returned in `top_k` are decoder beam scores, not calibrated probabilities.
- If a future Auto-AVSR version only exposes the single best transcript, the helper script already includes a TODO showing where to return rank 1 and where beam candidates would need to be exposed.
- Raw MP4 lip-reading quality depends heavily on face visibility, clip length, and detector success. Short, frontal, well-lit talking-head clips work best.
