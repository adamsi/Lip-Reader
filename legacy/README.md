# Legacy desktop app

The original standalone Chaplin desktop experience: a local OpenCV webcam window
that lip-reads, corrects with Claude, and (optionally) speaks the result. The
active product is the `backend/` + `app/` client-server stack; this is kept for
reference and local testing.

## Run

From the **repo root** (so model weights and `configs/` resolve):

```powershell
uv run python legacy/main.py
```

Controls (in the OpenCV window):

- **SPACE** — start / stop recording a clip
- **ESC** or **q** — quit

Needs a webcam, the VSR weights under `benchmarks/LRS3/`, and `ANTHROPIC_API_KEY`
in `.env`. Set `INWORLD_VOICE_ID` (+ `INWORLD_API_KEY`) to also hear the result
spoken aloud; leave it unset to run text-only.
