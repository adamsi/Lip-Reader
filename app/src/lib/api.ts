// Thin client for the Chaplin AI backend. Every call carries the Clerk
// session token as a Bearer header (obtained via getToken()).

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export type Voice = { id: string; name: string; description?: string; gender?: string };
export type Me = { voice_id: string | null; voice_source: string | null };

type TokenGetter = () => Promise<string | null>;

async function authHeaders(getToken: TokenGetter): Promise<HeadersInit> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getMe(getToken: TokenGetter): Promise<Me> {
  const res = await fetch(`${API_BASE}/me`, { headers: await authHeaders(getToken) });
  if (!res.ok) throw new Error(`/me failed: ${res.status}`);
  return res.json();
}

export async function getVoices(getToken: TokenGetter): Promise<Voice[]> {
  const res = await fetch(`${API_BASE}/voices`, { headers: await authHeaders(getToken) });
  if (!res.ok) throw new Error(`/voices failed: ${res.status}`);
  return (await res.json()).voices;
}

export async function selectVoice(getToken: TokenGetter, voiceId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/voice/select`, {
    method: "POST",
    headers: { ...(await authHeaders(getToken)), "Content-Type": "application/json" },
    body: JSON.stringify({ voice_id: voiceId }),
  });
  if (!res.ok) throw new Error(`/voice/select failed: ${res.status}`);
}

export async function enrollVoice(getToken: TokenGetter, clip: Blob): Promise<void> {
  const form = new FormData();
  form.append("file", clip, "voice.mp4");
  const res = await fetch(`${API_BASE}/voice/enroll`, {
    method: "POST",
    headers: await authHeaders(getToken),
    body: form,
  });
  if (!res.ok) throw new Error(`/voice/enroll failed: ${res.status}`);
}

export async function transcribe(getToken: TokenGetter, clip: Blob): Promise<string> {
  const form = new FormData();
  const ext = clip.type.includes("webm") ? "webm" : "mp4";
  form.append("file", clip, `clip.${ext}`);
  const res = await fetch(`${API_BASE}/transcribe`, {
    method: "POST",
    headers: await authHeaders(getToken),
    body: form,
  });
  if (!res.ok) throw new Error(`/transcribe failed: ${res.status}`);
  return (await res.json()).text;
}

// A token of spoken text with the audio time (seconds) at which it begins —
// used to draw the sentence in sync with playback.
export type SpokenToken = { t: string; start: number };

export async function speak(
  getToken: TokenGetter,
  text: string
): Promise<{ audioUrl: string; tokens: SpokenToken[] }> {
  const res = await fetch(`${API_BASE}/speak`, {
    method: "POST",
    headers: { ...(await authHeaders(getToken)), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`/speak failed: ${res.status}`);
  const data = await res.json();
  const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: data.mime || "audio/mpeg" });
  return { audioUrl: URL.createObjectURL(blob), tokens: data.tokens || [] };
}
