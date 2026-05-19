# Auto-AVSR Local Demo

This demo has:

- `backend/main.py`: FastAPI server with `POST /transcribe`
- `backend/auto_avsr_infer.py`: subprocess target that runs real Auto-AVSR inference on a single uploaded video file
- `frontend/`: React + TypeScript + Vite upload UI
- `backend/.env`: backend config
- `frontend/.env`: frontend API URL config

## 1. Clone Auto-AVSR

From the project root:

```powershell
git clone https://github.com/mpc001/auto_avsr.git ./auto_avsr
```

## 2. Create a Python virtual environment

From the project root in Git Bash:

```bash
"/c/Users/adams/AppData/Local/Programs/Python/Python311/python.exe" -m venv .venv
source .venv/Scripts/activate
python -m pip install --upgrade pip setuptools wheel
```

If Python 3.11 is installed somewhere else on your machine, use that interpreter path instead of the example above.

## 3. Install backend requirements

Install the backend dependencies from the single requirements file:

```bash
pip install -r backend/requirements.txt
```

Install the Auto-AVSR preparation dependencies:

```bash
pip install -r auto_avsr/preparation/requirements.txt
```

If you want to try RetinaFace instead of MediaPipe:

```bash
cd auto_avsr/preparation/tools
pip install -r requirements.txt
cd ../../..
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

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

The backend automatically loads `backend/.env`.

The API endpoint is:

- `POST http://localhost:8000/transcribe`

It expects multipart form data with a file field named `file`.

## 6. Install and run React

From the project root:

```bash
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
- Raw video lip-reading quality depends heavily on face visibility, clip length, and detector success. Short, frontal, well-lit talking-head clips work best.
