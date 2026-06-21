"""Inworld TTS: speak text in a voice, and enroll (clone) a new voice.

Voice enrollment takes an mp4 sample, extracts its audio to an in-memory WAV
(PyAV), and clones a voice. The clip itself is never persisted by this module;
the caller decides whether to keep the sample on disk.
"""
from __future__ import annotations

import io
import logging

from inworld_tts import InworldTTS

from . import config

log = logging.getLogger("chaplin.tts")

# Safe fallback if the Inworld voice catalog can't be fetched, so the
# onboarding list still renders. "Ashley" is a known-good stock EN_US voice.
FALLBACK_VOICES = [
    {"id": "Ashley", "name": "Ashley", "description": "Warm, friendly female voice.", "gender": "female"},
    {"id": "Mark", "name": "Mark", "description": "Clear, neutral male voice.", "gender": "male"},
]

_client: InworldTTS | None = None
_voices_cache: list[dict] | None = None


def _get_client() -> InworldTTS:
    global _client
    if _client is None:
        if not config.INWORLD_API_KEY:
            raise RuntimeError("INWORLD_API_KEY not configured")
        _client = InworldTTS()
    return _client


def list_voices(refresh: bool = False) -> list[dict]:
    """Return selectable voices from Inworld (English, cached).

    Each item: {id, name, description, gender}. Falls back to a tiny built-in
    list if the Inworld catalog can't be fetched, so onboarding always renders.
    """
    global _voices_cache
    if _voices_cache is not None and not refresh:
        return _voices_cache
    try:
        raw = _get_client().list_voices()
        voices = [
            {
                "id": v.get("voiceId"),
                "name": v.get("displayName") or v.get("voiceId"),
                "description": (v.get("description") or "").strip(),
                "gender": v.get("gender") or "",
            }
            for v in raw
            if v.get("voiceId") and str(v.get("langCode", "")).upper().startswith("EN")
        ]
        voices.sort(key=lambda x: x["name"].lower())
        _voices_cache = voices or FALLBACK_VOICES
    except Exception as e:  # noqa: BLE001
        log.warning("Inworld list_voices failed, using fallback: %s", e)
        _voices_cache = FALLBACK_VOICES
    return _voices_cache


def is_valid_voice(voice_id: str) -> bool:
    return any(v["id"] == voice_id for v in list_voices())


def synthesize(text: str, voice_id: str) -> bytes:
    """Return spoken audio (MP3 bytes) for ``text`` in ``voice_id``."""
    return _get_client().generate(text=text, voice=voice_id, encoding="MP3")


def synthesize_with_timestamps(text: str, voice_id: str):
    """Return (mp3_bytes, tokens) where tokens carry per-word start times so the
    client can draw the sentence in sync with the spoken audio.

    Falls back to plain audio (empty tokens) if word timing is unavailable.
    """
    try:
        r = _get_client().generate_with_timestamps(
            text=text, timestamp_type="WORD", voice=voice_id, encoding="MP3"
        )
        audio = r["audio"]
        wa = (r.get("timestamps") or {}).get("wordAlignment") or {}
        words = wa.get("words", [])
        starts = wa.get("wordStartTimeSeconds", [])
        tokens = [{"t": w, "start": float(s)} for w, s in zip(words, starts) if w != ""]
        return audio, tokens
    except Exception as e:  # noqa: BLE001
        log.warning("timestamped TTS failed, falling back to plain audio: %s", e)
        return synthesize(text, voice_id), []


def _extract_wav(mp4_bytes: bytes) -> bytes:
    """Extract the audio track of an mp4 to mono 16-bit WAV bytes (PyAV)."""
    import wave

    import av

    in_buf = io.BytesIO(mp4_bytes)
    container = av.open(in_buf)
    astream = next((s for s in container.streams if s.type == "audio"), None)
    if astream is None:
        raise ValueError("voice sample has no audio track")

    resampler = av.AudioResampler(format="s16", layout="mono", rate=24000)
    pcm = bytearray()
    for frame in container.decode(astream):
        for rframe in resampler.resample(frame):
            pcm += bytes(rframe.planes[0])[: rframe.samples * 2]
    container.close()

    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(bytes(pcm))
    return out.getvalue()


def enroll_voice(mp4_bytes: bytes, display_name: str = "My Voice") -> str:
    """Clone a voice from an mp4 sample. Returns the new Inworld voice id."""
    wav_bytes = _extract_wav(mp4_bytes)
    result = _get_client().clone_voice([wav_bytes], display_name=display_name)
    voice_id = result.get("voiceId") if isinstance(result, dict) else None
    if not voice_id:
        raise RuntimeError(f"voice clone returned no voiceId: {result!r}")
    return voice_id
