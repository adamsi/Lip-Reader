// Thin client for the Chaplin AI backend. No auth — the API is open.
// In dev the Vite server talks to the backend on :8000; the production build
// is served by the backend itself, so relative URLs work.

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost:8000" : "");

// Exposed so the UI (About modal) can show where the API actually lives.
export { API_BASE };

export type Voice = { id: string; name: string; description?: string; gender?: string };

// One traced LLM/VSR call of the agent workflow.
export type Step = {
  module: string;
  prompt: Record<string, unknown>;
  response: Record<string, unknown>;
};

export type ExecuteResult = { response: string; steps: Step[] };

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

/** Text prompt -> corrected sentence + full steps trace. */
export async function executeText(prompt: string): Promise<ExecuteResult> {
  const res = await fetch(`${API_BASE}/api/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`/api/execute failed: ${res.status}`);
  return unwrap(await res.json());
}

/** Webcam clip -> VSR -> agent -> corrected sentence + steps trace. */
export async function executeLips(clip: Blob): Promise<ExecuteResult> {
  const form = new FormData();
  const ext = clip.type.includes("webm") ? "webm" : "mp4";
  form.append("file", clip, `clip.${ext}`);
  const res = await fetch(`${API_BASE}/api/execute_lips`, {
    method: "POST",
    body: form,
  });
  // Serverless edges reject large uploads before they reach the backend.
  if (res.status === 413) {
    throw new Error("Recording too large to upload on this deployment - use Run Agent instead.");
  }
  if (!res.ok) throw new Error(`/api/execute_lips failed: ${res.status}`);
  return unwrap(await res.json());
}

/** Fire-and-forget ping so the backend's cold start (container boot + VSR
 * model load on Modal) begins the moment the page loads, not on first use. */
export function warmBackend(): void {
  fetch(`${API_BASE}/health`).catch(() => {});
}

/** Whether this deployment can run the lip-reading model (false on serverless). */
export async function vsrAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
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
