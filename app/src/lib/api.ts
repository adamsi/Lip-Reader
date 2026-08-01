// API backend (Vercel, :8000 in dev) + vsr_lip_reader service (Modal, :8001 in dev).

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:8000" : "");

const VSR_BASE =
  import.meta.env.VITE_VSR_API_BASE ||
  (import.meta.env.DEV
    ? "http://localhost:8001"
    : "https://adamsi--chaplin-ai-backend.modal.run");

export { API_BASE, VSR_BASE };

export type Voice = { id: string; name: string; description?: string; gender?: string };

export type Step = {
  module: string;
  prompt: Record<string, unknown>;
  response: Record<string, unknown>;
};

export type ExecuteResult = { response: string; steps: Step[] };

// short-term memory window sent with agent requests (see lib/chat.ts)
export type WireMessage = { role: "self" | "other"; content: string };

type ExecuteEnvelope = {
  status: "ok" | "error";
  error: string | null;
  response: string | null;
  steps: Step[];
};

function unwrap(data: ExecuteEnvelope): ExecuteResult {
  if (data.status !== "ok" || !data.response) {
    throw new Error(data.error || "agent failed");
  }
  return { response: data.response, steps: data.steps || [] };
}

export async function executeText(
  prompt: string,
  conversation?: WireMessage[]
): Promise<ExecuteResult> {
  const res = await fetch(`${API_BASE}/api/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      conversation?.length ? { prompt, conversation } : { prompt }
    ),
  });
  if (!res.ok) throw new Error(`/api/execute failed: ${res.status}`);
  return unwrap(await res.json());
}

export async function executeLips(
  clip: Blob,
  conversation?: WireMessage[]
): Promise<ExecuteResult> {
  const form = new FormData();
  const ext = clip.type.includes("webm") ? "webm" : "mp4";
  form.append("file", clip, `clip.${ext}`);
  if (conversation?.length) form.append("conversation", JSON.stringify(conversation));
  const res = await fetch(`${VSR_BASE}/api/execute_lips`, {
    method: "POST",
    body: form,
  });
  if (res.status === 413) {
    throw new Error("Recording too large to upload on this deployment - use Run Agent instead.");
  }
  if (!res.ok) throw new Error(`/api/execute_lips failed: ${res.status}`);
  return unwrap(await res.json());
}

// fire-and-forget pings so cold starts begin on page load
export function warmBackend(): void {
  fetch(`${API_BASE}/health`).catch(() => {});
  fetch(`${VSR_BASE}/health`).catch(() => {});
}

export async function vsrAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${VSR_BASE}/health`);
    if (!res.ok) return true;
    return (await res.json()).vsr_available !== false;
  } catch {
    return true; // don't block Talk on a health hiccup
  }
}

export const architectureUrl = `${API_BASE}/api/model_architecture`;

export async function getVoices(): Promise<Voice[]> {
  const res = await fetch(`${API_BASE}/voices`);
  if (!res.ok) throw new Error(`/voices failed: ${res.status}`);
  return (await res.json()).voices;
}

export async function selectVoice(voiceId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/voice/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voice_id: voiceId }),
  });
  if (!res.ok) throw new Error(`/voice/select failed: ${res.status}`);
}

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
