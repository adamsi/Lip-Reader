import { useEffect, useRef, useState } from "react";
import { enrollVoice, getVoices, selectVoice, Voice } from "../lib/api";
import { setStoredVoiceId } from "../lib/voice";
import { useRecorder } from "../lib/useRecorder";
import UserMenu from "./UserMenu";
import Spinner from "./Spinner";

type Tab = "preset" | "record";

export default function Onboarding({
  onDone,
  canCancel,
  onCancel,
}: {
  onDone: () => void;
  canCancel?: boolean;
  onCancel?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("preset");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingVoices(true);
    getVoices()
      .then(setVoices)
      .catch(() => setError("Couldn't load voices."))
      .finally(() => setLoadingVoices(false));
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? voices.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          (v.description || "").toLowerCase().includes(q) ||
          (v.gender || "").toLowerCase().includes(q)
      )
    : voices;

  async function choosePreset(voiceId: string) {
    setBusy(true);
    setError(null);
    try {
      await selectVoice(voiceId);
      setStoredVoiceId(voiceId);
      onDone();
    } catch {
      setError("Couldn't save that voice. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-6">
      <header
        className="flex items-center justify-between py-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)" }}
      >
        <div className="flex items-center gap-2">
          <img src="/chaplin_logo.png" alt="" className="h-7 w-7" />
          <span className="text-lg font-bold tracking-tight text-gray-900">Chaplin AI</span>
        </div>
        <div className="flex items-center gap-3">
          {canCancel && (
            <button
              onClick={onCancel}
              className="text-sm font-semibold text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
          )}
          <UserMenu />
        </div>
      </header>

      <h1 className="mt-1 text-2xl font-bold text-gray-900">Choose your voice</h1>
      <p className="mt-1 text-gray-500">This is how Chaplin will speak for you.</p>

      <div className="mt-5 flex rounded-xl bg-gray-100 p-1">
        {(["preset", "record"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
              tab === t ? "bg-white text-gray-900 shadow-soft" : "text-gray-500"
            }`}
          >
            {t === "preset" ? "Pick a voice" : "Use my voice"}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {tab === "preset" ? (
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search voices…"
            className="mb-3 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base outline-none focus:border-brand-400"
          />
          {loadingVoices ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <Spinner size={26} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-gray-400">No voices match “{query}”.</p>
          ) : (
            <div className="flex flex-col gap-2 overflow-y-auto pb-2">
              {filtered.map((v) => (
                <button
                  key={v.id}
                  disabled={busy}
                  onClick={() => choosePreset(v.id)}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-soft transition hover:border-brand-400 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{v.name}</span>
                      {v.gender && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {v.gender}
                        </span>
                      )}
                    </span>
                    {v.description && (
                      <span className="mt-0.5 line-clamp-2 block text-sm text-gray-500">
                        {v.description}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-medium text-brand-600">Select →</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <VoiceRecorder busy={busy} setBusy={setBusy} onEnrolled={onDone} onError={setError} />
      )}
    </div>
  );
}

function VoiceRecorder({
  busy,
  setBusy,
  onEnrolled,
  onError,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  onEnrolled: () => void;
  onError: (m: string) => void;
}) {
  const { state, error, start, stop, attachPreview } = useRecorder();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    attachPreview(videoRef.current);
  }, [attachPreview]);

  async function finish() {
    setBusy(true);
    onError("");
    const clip = await stop();
    if (!clip) return setBusy(false);
    try {
      const voiceId = await enrollVoice(clip);
      setStoredVoiceId(voiceId);
      onEnrolled();
    } catch {
      onError("Couldn't create your voice. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col items-center">
      <p className="mb-3 text-center text-sm text-gray-500">
        Record ~10 seconds of yourself speaking naturally. We’ll clone your voice.
      </p>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="aspect-video w-full rounded-2xl bg-gray-900 object-cover"
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {state === "idle" ? (
        <button
          disabled={busy}
          onClick={start}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-4 text-lg font-semibold text-white shadow-soft transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy && <Spinner size={18} light />}
          {busy ? "Creating your voice…" : "Start recording"}
        </button>
      ) : (
        <button
          onClick={finish}
          className="mt-5 w-full rounded-xl bg-red-600 py-4 text-lg font-semibold text-white shadow-soft transition hover:bg-red-700"
        >
          Stop & use this voice
        </button>
      )}
    </div>
  );
}
