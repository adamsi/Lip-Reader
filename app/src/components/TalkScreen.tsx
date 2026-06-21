import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { speak, SpokenToken, transcribe } from "../lib/api";
import { useRecorder } from "../lib/useRecorder";
import UserMenu from "./UserMenu";
import Spinner from "./Spinner";

type Phase = "idle" | "recording" | "thinking" | "result" | "speaking";

export default function TalkScreen({ onChangeVoice }: { onChangeVoice: () => void }) {
  const { getToken } = useAuth();
  const { error, start, stop, attachPreview, startCamera } = useRecorder();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [tokens, setTokens] = useState<SpokenToken[]>([]);
  const [spoken, setSpoken] = useState(0); // count of tokens revealed so far
  const [apiError, setApiError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Live preview as soon as the screen mounts (full-screen, not mirrored).
  useEffect(() => {
    attachPreview(videoRef.current);
    startCamera().catch(() => setApiError("Camera access is required."));
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [attachPreview, startCamera]);

  function clearUtterance() {
    setText("");
    setTokens([]);
    setSpoken(0);
    setApiError(null);
  }

  async function record() {
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
      setText(result);
      setPhase("result");
    } catch {
      setApiError("Something went wrong. Tap Talk to try again.");
      setPhase("idle");
    }
  }

  async function approve() {
    setPhase("speaking");
    setSpoken(0);
    try {
      const { audioUrl, tokens: tk } = await speak(getToken, text);
      setTokens(tk);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      const tick = () => {
        const ct = audio.currentTime;
        let n = 0;
        while (n < tk.length && tk[n].start <= ct) n++;
        setSpoken(n);
        if (!audio.paused && !audio.ended) rafRef.current = requestAnimationFrame(tick);
      };
      audio.onplay = () => (rafRef.current = requestAnimationFrame(tick));
      audio.onended = () => {
        setSpoken(tk.length);
        setPhase("result");
        URL.revokeObjectURL(audioUrl);
      };
      await audio.play();
    } catch {
      setApiError("Couldn't play the voice.");
      setPhase("result");
    }
  }

  const hasResult = phase === "result" || phase === "speaking";

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

      {/* Account menu, top-left (no chip). */}
      <div
        className="absolute left-4 z-20"
        style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <UserMenu onChangeVoice={onChangeVoice} />
      </div>

      {/* Thinking spinner, centered over the camera. */}
      {phase === "thinking" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-2xl bg-black/55 p-5 backdrop-blur">
            <Spinner size={32} light />
          </div>
        </div>
      )}

      {/* Bottom overlay controls (kept compact to give the camera more space). */}
      <div
        className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-5 pt-12"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        {(error || apiError) && (
          <p className="text-center text-sm font-medium text-red-300">{error || apiError}</p>
        )}

        {hasResult && (
          <div className="max-h-[28vh] overflow-y-auto">
            <p className="text-center text-2xl font-semibold leading-snug text-white drop-shadow">
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

        {!hasResult ? (
          // Small centered glass pill.
          <div className="flex justify-center">
            <PrimaryButton
              onClick={phase === "recording" ? finishRecording : record}
              disabled={phase === "thinking"}
              variant={phase === "recording" ? "danger" : "brand"}
              icon={phase === "recording" ? <StopIcon /> : <MicIcon />}
              label={phase === "recording" ? "Stop" : phase === "thinking" ? "Thinking…" : "Talk"}
            />
          </div>
        ) : (
          // Talk again + Approve & speak side by side.
          <div className="flex gap-3">
            <PrimaryButton
              compact
              className="flex-1"
              onClick={record}
              disabled={phase === "speaking"}
              variant="ghost"
              icon={<RepeatIcon />}
              label="Talk again"
            />
            <PrimaryButton
              compact
              className="flex-1"
              onClick={approve}
              disabled={phase === "speaking"}
              variant="brand"
              icon={phase === "speaking" ? <Spinner size={18} light /> : <SpeakerIcon />}
              label={phase === "speaking" ? "Speaking…" : "Approve & speak"}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// iOS 26 "Liquid Glass" button: translucent frosted capsule with a heavy
// backdrop blur + saturation, a bright specular top highlight, a thin light
// rim, and an inner shadow for depth. The variant only changes the subtle tint.
function PrimaryButton({
  onClick,
  disabled,
  variant,
  icon,
  label,
  compact,
  className = "",
}: {
  onClick: () => void;
  disabled?: boolean;
  variant: "brand" | "danger" | "ghost";
  icon: React.ReactNode;
  label: string;
  compact?: boolean;
  className?: string;
}) {
  const tint = {
    brand: "bg-brand-500/30",
    danger: "bg-red-500/35",
    ghost: "bg-white/12",
  }[variant];
  const size = compact ? "px-4 py-2.5 text-sm" : "px-8 py-2.5 text-base";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full border border-white/30 font-semibold text-white backdrop-blur-2xl backdrop-saturate-[1.8] transition active:scale-[0.97] disabled:opacity-50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),inset_0_-3px_8px_rgba(0,0,0,0.25),0_8px_28px_rgba(0,0,0,0.35)] ${tint} ${size} ${className}`}
    >
      {/* specular sheen across the top half */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent" />
      <span className="relative flex items-center gap-2 drop-shadow-sm">
        {icon}
        {label}
      </span>
    </button>
  );
}

/* — inline icons (no icon dependency) — */
const MicIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);
const StopIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
const SpeakerIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 5a9 9 0 0 1 0 14" />
  </svg>
);
const RepeatIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);
