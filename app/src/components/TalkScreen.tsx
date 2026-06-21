import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { speak, SpokenToken, transcribe } from "../lib/api";
import { useRecorder } from "../lib/useRecorder";
import UserMenu from "./UserMenu";
import Spinner from "./Spinner";

// Simple communication-turn loop:
//   idle ── Talk ──▶ recording ── Stop ──▶ thinking ──▶ review
//   review: shows the sentence + [Speak] (voice it) and [Talk] (start over)
//   review ── Speak ──▶ speaking (words draw in sync) ── ends/Stop ──▶ review
// The sentence stays on screen until Talk is pressed.
type Phase = "idle" | "recording" | "thinking" | "review" | "speaking";

export default function TalkScreen({ onChangeVoice }: { onChangeVoice: () => void }) {
  const { getToken } = useAuth();
  const { error, start, stop, attachPreview, startCamera } = useRecorder();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [tokens, setTokens] = useState<SpokenToken[]>([]);
  const [spoken, setSpoken] = useState(0); // count of tokens revealed so far
  const [preparing, setPreparing] = useState(false); // fetching audio
  const [recSeconds, setRecSeconds] = useState(0);
  const [apiError, setApiError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  // Live preview as soon as the screen mounts (full-screen, not mirrored).
  useEffect(() => {
    attachPreview(videoRef.current);
    startCamera().catch(() => setApiError("Camera access is required."));
    return () => stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachPreview, startCamera]);

  // Elapsed-time counter shown in the "Listening" status pill.
  useEffect(() => {
    if (phase !== "recording") return;
    setRecSeconds(0);
    const id = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  function stopAudio() {
    const a = audioRef.current;
    if (a) {
      a.onended = null;
      a.pause();
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    audioRef.current = null;
  }

  function clearUtterance() {
    setText("");
    setTokens([]);
    setSpoken(0);
    setApiError(null);
  }

  // Talk — always starts a fresh utterance (and clears the previous sentence).
  async function record() {
    stopAudio();
    clearUtterance();
    await start();
    setPhase("recording");
  }

  async function finishRecording() {
    setPhase("thinking");
    const clip = await stop();
    if (!clip) return setPhase("idle");
    try {
      const result = await transcribe(getToken, clip);
      if (/^i didn'?t catch/i.test(result)) {
        setApiError("Didn't catch that — try again.");
        return setPhase("idle");
      }
      setText(result);
      setPhase("review"); // show the sentence; the human confirms before voicing
    } catch {
      setApiError("Something went wrong. Tap Talk to try again.");
      setPhase("idle");
    }
  }

  // Word-by-word reveal driven by the audio clock.
  function startTick(audio: HTMLAudioElement, tk: SpokenToken[]) {
    const tick = () => {
      let n = 0;
      while (n < tk.length && tk[n].start <= audio.currentTime) n++;
      setSpoken(n);
      if (!audio.paused && !audio.ended) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  // Speak — voice the sentence aloud (always from the beginning). The audio is
  // cached, so tapping Speak again just replays it without re-fetching.
  async function speakNow() {
    const existing = audioRef.current;
    if (existing) {
      existing.currentTime = 0;
      setSpoken(0);
      setPhase("speaking");
      existing.play();
      return;
    }
    setPreparing(true);
    setApiError(null);
    try {
      const { audioUrl, tokens: tk } = await speak(getToken, text);
      setTokens(tk);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audioUrlRef.current = audioUrl;
      audio.onplay = () => {
        setPreparing(false);
        setPhase("speaking");
        startTick(audio, tk);
      };
      audio.onended = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        setSpoken(tk.length);
        setPhase("review"); // back to the sentence; Speak can repeat it
      };
      await audio.play();
    } catch {
      setPreparing(false);
      setApiError("Couldn't play the voice.");
    }
  }

  // Stop — interrupt playback and return to the sentence.
  function interrupt() {
    audioRef.current?.pause();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setSpoken(tokens.length);
    setPhase("review");
  }

  const showText = phase === "review" || phase === "speaking";
  const mmss = `${Math.floor(recSeconds / 60)}:${String(recSeconds % 60).padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      {/* Full-screen camera. `-scale-x-100` un-mirrors the front-camera preview
          so it shows the true (non-flipped) orientation. Display only — the
          recorded clip sent to the model is unaffected. */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
      />

      {/* Dim the camera while a sentence is on screen so the words pop. */}
      {showText && <div className="absolute inset-0 z-10 bg-black/45" />}

      {/* Account avatar, top-left (bare — no chip). */}
      <div className="absolute left-4 z-30" style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}>
        <UserMenu onChangeVoice={onChangeVoice} />
      </div>

      {/* Recording status pill, top-center. */}
      {phase === "recording" && (
        <div
          className="absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-3.5 py-1.5 backdrop-blur"
          style={{ top: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <span className="text-sm font-medium text-white">Listening · {mmss}</span>
        </div>
      )}

      {/* Thinking spinner, centered. */}
      {phase === "thinking" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-2xl bg-black/55 p-5 backdrop-blur">
            <Spinner size={32} light />
          </div>
        </div>
      )}

      {/* The sentence — centered and prominent. Stays until Talk is pressed. */}
      {showText && (
        <div className="absolute inset-x-0 top-[16%] bottom-[34%] z-20 flex items-center justify-center overflow-y-auto px-6">
          <p className="animate-pop mx-auto max-w-lg text-center text-3xl font-semibold leading-snug text-white drop-shadow-lg">
            {tokens.length > 0
              ? tokens.map((tk, i) => (
                  <span key={i} className={i < spoken ? "opacity-100" : "opacity-40"}>
                    {tk.t}
                  </span>
                ))
              : text}
          </p>
        </div>
      )}

      {/* Bottom controls — one centered, phone-width column (consistent on web,
          full-width on mobile). One clear primary action per state. */}
      <div
        className="absolute inset-x-0 bottom-0 z-30 px-5 pt-12"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <div className="mx-auto w-full max-w-sm">
          {(error || apiError) && (
            <p className="mb-3 text-center text-sm font-medium text-red-300">{error || apiError}</p>
          )}

          {phase === "idle" && (
            <GlassButton className="w-full" onClick={record} variant="ghost" icon={<RecordDot />} label="Talk" />
          )}

          {phase === "recording" && (
            <GlassButton className="w-full" onClick={finishRecording} variant="danger" icon={<StopIcon />} label="Stop" />
          )}

          {phase === "review" && (
            <div className="flex flex-col items-center gap-3">
              {/* Speak — the affirmative payoff (also "speak again" after it plays). */}
              <button
                onClick={speakNow}
                disabled={preparing}
                className="relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-green-600 py-4 text-xl font-bold text-white shadow-[0_12px_34px_rgba(22,120,60,0.55)] transition hover:bg-green-700 active:scale-[0.98] disabled:opacity-90"
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
                <span className="relative flex items-center gap-2.5">
                  {preparing ? <Spinner size={24} light /> : <SpeakerIcon size={24} />}
                  {preparing ? "Preparing…" : "Speak"}
                </span>
              </button>
              {/* Talk — start a new sentence (clears this one). */}
              <GlassButton className="w-full" onClick={record} variant="ghost" icon={<RecordDot />} label="Talk" />
            </div>
          )}

          {phase === "speaking" && (
            <GlassButton className="w-full" onClick={interrupt} variant="danger" icon={<StopIcon />} label="Stop" />
          )}
        </div>
      </div>
    </div>
  );
}

// iOS 26 "Liquid Glass" button: translucent frosted capsule with a heavy
// backdrop blur + saturation, a bright specular top highlight, a thin light
// rim, and an inner shadow for depth. The variant only changes the subtle tint.
function GlassButton({
  onClick,
  disabled,
  variant,
  icon,
  label,
  className = "",
}: {
  onClick: () => void;
  disabled?: boolean;
  variant: "danger" | "ghost";
  icon: React.ReactNode;
  label: string;
  className?: string;
}) {
  const tint = { danger: "bg-red-500/35", ghost: "bg-white/12" }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full border border-white/30 px-8 py-2.5 text-base font-semibold text-white backdrop-blur-2xl backdrop-saturate-[1.8] transition active:scale-[0.97] disabled:opacity-50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),inset_0_-3px_8px_rgba(0,0,0,0.25),0_8px_28px_rgba(0,0,0,0.35)] ${tint} ${className}`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent" />
      <span className="relative flex items-center gap-2 drop-shadow-sm">
        {icon}
        {label}
      </span>
    </button>
  );
}

/* — inline icons (no icon dependency) — */
const RecordDot = () => <span className="h-3 w-3 rounded-full bg-red-500" />;
const StopIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
const SpeakerIcon = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 5a9 9 0 0 1 0 14" />
  </svg>
);
