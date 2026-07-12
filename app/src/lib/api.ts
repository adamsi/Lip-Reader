// Thin client for the Chaplin AI backend. No auth — the API is open on
// localhost and the selected voice is sent along with each /speak call.

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export type Voice = { id: string; name: string; description?: string; gender?: string };

export async function getVoices(): Promise<Voice[]> {
  const res = await fetch(`${API_BASE}/voices`);
  if (!res.ok) throw new Error(`/voices failed: ${res.status}`);
  return (await res.json()).voices;
}

/** Validates the voice against the catalog on the backend. */
export async function selectVoice(voiceId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/voice/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voice_id: voiceId }),
  });
  if (!res.ok) throw new Error(`/voice/select failed: ${res.status}`);
}

/** Clones a voice from the sample; returns the new voice id to store locally. */
export async function enrollVoice(clip: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", clip, "voice.mp4");
  const res = await fetch(`${API_BASE}/voice/enroll`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`/voice/enroll failed: ${res.status}`);
  return (await res.json()).voice_id;
}

export async function transcribe(clip: Blob): Promise<string> {
  const form = new FormData();
  const ext = clip.type.includes("webm") ? "webm" : "mp4";
  form.append("file", clip, `clip.${ext}`);
  const res = await fetch(`${API_BASE}/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`/transcribe failed: ${res.status}`);
  return (await res.json()).text;
}

// A token of spoken text with the audio time (seconds) at which it begins —
// used to draw the sentence in sync with playback.
export type SpokenToken = { t: string; start: number };

export async function speak(
  text: string,
  voiceId: string | null
): Promise<{ audioUrl: string; tokens: SpokenToken[] }> {
  const res = await fetch(`${API_BASE}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId }),
  });
  if (!res.ok) throw new Error(`/speak failed: ${res.status}`);
  const data = await res.json();
  const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: data.mime || "audio/mpeg" });
  return { audioUrl: URL.createObjectURL(blob), tokens: data.tokens || [] };
}
