"""Legacy desktop Chaplin app (OpenCV webcam loop + Inworld voice playback).

This is the original standalone desktop experience, preserved here. The active
product is the FastAPI backend (`backend/`) + React SPA (`app/`); this file is
kept self-contained so it keeps working without affecting the new stack.

Run it via `legacy/main.py` from the repo root:  uv run python legacy/main.py
"""
import cv2
import time
import io
import json
import logging
import anthropic
import sounddevice as sd
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from inworld_tts import InworldTTS
import os
import asyncio
from dotenv import load_dotenv

load_dotenv(override=True)
log = logging.getLogger("chaplin")
log.setLevel(logging.INFO)
if not log.handlers:
    _fh = logging.FileHandler("lipreader.log")
    _fh.setFormatter(logging.Formatter("%(asctime)s %(message)s", datefmt="%H:%M:%S"))
    log.addHandler(_fh)


LLM_SYSTEM_PROMPT = (
    "You are an assistant that helps make corrections to the output of a lipreading model. "
    "The text you will receive was transcribed using a video-to-text system that attempts to "
    "lipread the subject speaking in the video, so the text will likely be imperfect. The input "
    "text will also be in all-caps, although your response should be capitalized correctly and "
    "should NOT be in all-caps.\n\n"
    "If something seems unusual, assume it was mistranscribed. Do your best to infer the words "
    "actually spoken, and make changes to the mistranscriptions in your response. Do not add more "
    "words or content, just change the ones that seem to be out of place (and, therefore, "
    "mistranscribed). Do not change even the wording of sentences, just individual words that look "
    "nonsensical in the context of all of the other words in the sentence.\n\n"
    "Also, add correct punctuation to the entire text. ALWAYS end each sentence with the "
    "appropriate sentence ending: '.', '?', or '!'.\n\n"
    "Output ONLY the corrected text, with no commentary, explanation, or extra formatting."
)


class Chaplin:
    def __init__(self):
        self.vsr_model = None
        self.recording = False
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.tts_executor = ThreadPoolExecutor(max_workers=1)

        self.output_prefix = "webcam"
        self.fps = 16
        self.frame_interval = 1 / self.fps

        self.transcripts = []  # list of {"raw": str, "corrected": str|None}
        self.processing = False

        self.anthropic_client = anthropic.AsyncAnthropic()
        self.voice_id = os.getenv("INWORLD_VOICE_ID")
        # TTS (voice cloning) is optional — only init when a voice is configured.
        self.tts_client = None
        if self.voice_id:
            try:
                self.tts_client = InworldTTS()
            except Exception as e:
                log.warning("Inworld TTS init failed, disabling TTS: %s", e)
                self.voice_id = None
        self.loop = asyncio.new_event_loop()
        self.async_thread = ThreadPoolExecutor(max_workers=1)
        self.async_thread.submit(self._run_event_loop)

        self.next_sequence = 0
        self.current_sequence = 0
        self.typing_lock = None
        self._init_async_resources()

    def _run_event_loop(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def _init_async_resources(self):
        future = asyncio.run_coroutine_threadsafe(
            self._create_async_lock(), self.loop)
        future.result()

    async def _create_async_lock(self):
        self.typing_lock = asyncio.Lock()
        self.typing_condition = asyncio.Condition(self.typing_lock)

    def toggle_recording(self):
        self.recording = not self.recording

    def _speak(self, text):
        """Synthesize text with cloned voice and play it (non-blocking)."""
        if not self.voice_id:
            return
        self.tts_executor.submit(self._speak_sync, text)

    def _speak_sync(self, text):
        """Blocking TTS call — runs in a thread."""
        try:
            import wave
            audio_bytes = self.tts_client.generate(
                text=text,
                voice=self.voice_id,
                encoding="WAV",
                sample_rate=24000,
            )
            wav_io = io.BytesIO(audio_bytes)
            with wave.open(wav_io) as wf:
                frames = wf.readframes(wf.getnframes())
                audio_array = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
                sd.play(audio_array, samplerate=wf.getframerate())
                sd.wait()
        except Exception as e:
            log.warning("TTS failed: %s", e)

    async def correct_output_async(self, entry, sequence_num):
        # Constrain the response to a JSON object with a single `corrected`
        # field so the model cannot leak preamble or commentary into the output.
        response = await self.anthropic_client.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=1024,
            system=LLM_SYSTEM_PROMPT,
            messages=[
                {'role': 'user', 'content': f"Transcription:\n\n{entry['top1']}"},
            ],
            output_config={
                "format": {
                    "type": "json_schema",
                    "schema": {
                        "type": "object",
                        "properties": {"corrected": {"type": "string"}},
                        "required": ["corrected"],
                        "additionalProperties": False,
                    },
                }
            },
        )

        raw = next((b.text for b in response.content if getattr(b, "type", None) == "text"), "")
        try:
            corrected = json.loads(raw).get("corrected", "").strip()
        except (json.JSONDecodeError, AttributeError):
            corrected = raw.strip()
        log.info("LLM corrected: %s", corrected)
        if corrected and corrected[-1] not in '.?!':
            corrected += '.'

        async with self.typing_condition:
            while self.next_sequence != sequence_num:
                await self.typing_condition.wait()

            entry['corrected'] = corrected
            # Single atomic write, emitted in sequence order so each clip's
            # model output sits next to its correction with no interleaving.
            print(
                f"\n[#{sequence_num}]\n"
                f"MODEL: {entry['top1']}\n"
                f"LLM  : {corrected}\n",
                flush=True,
            )
            self._speak(corrected)

            self.next_sequence += 1
            self.typing_condition.notify_all()

        return corrected

    def perform_inference(self, video_path):
        self.processing = True
        transcription = self.vsr_model(video_path)

        entry = {"top1": transcription, "corrected": None}
        self.transcripts.append(entry)

        sequence_num = self.current_sequence
        self.current_sequence += 1

        asyncio.run_coroutine_threadsafe(
            self.correct_output_async(entry, sequence_num),
            self.loop
        )
        self.processing = False

        return {"output": transcription, "video_path": video_path}

    def start_webcam(self):
        cap = cv2.VideoCapture(0)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        futures = []
        output_path = ""
        out = None
        frame_count = 0

        while True:
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == 27:
                for file in os.listdir():
                    if file.startswith(self.output_prefix) and file.endswith('.mp4'):
                        os.remove(file)
                break
            elif key == ord(' '):
                self.toggle_recording()

            ret, frame = cap.read()
            if not ret:
                continue
            display_frame = frame.copy()

            if self.recording:
                if out is None:
                    output_path = self.output_prefix + \
                        str(time.time_ns() // 1_000_000) + '.mp4'
                    out = cv2.VideoWriter(
                        output_path,
                        cv2.VideoWriter_fourcc(*'mp4v'),
                        self.fps,
                        (frame_width, frame_height),
                        True
                    )

                out.write(frame)
                cv2.circle(display_frame, (frame_width - 20, 20), 10, (0, 0, 255), -1)
                frame_count += 1

            elif not self.recording and frame_count > 0:
                if out is not None:
                    out.release()
                    out = None

                if frame_count >= self.fps:
                    futures.append(self.executor.submit(
                        self.perform_inference, output_path))
                else:
                    os.remove(output_path)

                frame_count = 0

            display_frame = cv2.flip(display_frame, 1)
            self._draw_status(display_frame, self.recording, frame_count)
            self._draw_transcript(display_frame, frame_width, frame_height)
            cv2.imshow('Lipreader', display_frame)

            for fut in futures[:]:
                if fut.done():
                    result = fut.result()
                    if os.path.exists(result["video_path"]):
                        os.remove(result["video_path"])
                    futures.remove(fut)
                else:
                    break

        cap.release()
        if out:
            out.release()
        cv2.destroyAllWindows()

        self.loop.call_soon_threadsafe(self.loop.stop)
        self.async_thread.shutdown(wait=True)
        self.executor.shutdown(wait=True)

    def _draw_status(self, frame, recording, frame_count):
        font = cv2.FONT_HERSHEY_SIMPLEX
        if recording:
            secs = frame_count / self.fps
            text = f"Recording... {secs:.1f}s (SPACE to stop)"
            color = (0, 0, 255)
        elif self.processing:
            text = "Processing..."
            color = (0, 200, 255)
        else:
            text = "SPACE: record | ESC: quit"
            color = (255, 255, 255)

        text_size = cv2.getTextSize(text, font, 0.6, 2)[0]
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (text_size[0] + 20, 35), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)
        cv2.putText(frame, text, (10, 25), font, 0.6, color, 2)

    def _draw_transcript(self, frame, width, height):
        if not self.transcripts:
            return

        latest = self.transcripts[-1]
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.55
        thickness = 1
        margin = 10
        max_width = width - 2 * margin

        sections = []

        top1_text = latest.get('top1', '')
        if top1_text:
            sections.append(("MODEL:", top1_text, (180, 180, 180)))

        corrected = latest.get('corrected')
        if corrected:
            sections.append(("LLM:", corrected, (100, 255, 100)))

        all_lines = []
        for label, text, color in sections:
            lines = self._wrap_text(f"{label} {text}".strip(), font, font_scale, thickness, max_width)
            all_lines.extend([(line, color) for line in lines])

        line_height = cv2.getTextSize("A", font, font_scale, thickness)[0][1] + 8
        box_height = len(all_lines) * line_height + 2 * margin
        y_start = height - box_height

        overlay = frame.copy()
        cv2.rectangle(overlay, (0, y_start), (width, height), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)

        for i, (line, color) in enumerate(all_lines):
            y = y_start + margin + (i + 1) * line_height
            cv2.putText(frame, line, (margin, y), font, font_scale, color, thickness)

    @staticmethod
    def _wrap_text(text, font, font_scale, thickness, max_width):
        words = text.split()
        lines = []
        current_line = ""
        for word in words:
            test = f"{current_line} {word}".strip()
            if cv2.getTextSize(test, font, font_scale, thickness)[0][0] <= max_width:
                current_line = test
            else:
                if current_line:
                    lines.append(current_line)
                current_line = word
        if current_line:
            lines.append(current_line)
        return lines
