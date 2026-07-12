import { useEffect, useRef, useState } from "react";
import { executeLips, speak, SpokenToken, Step, vsrAvailable } from "../lib/api";
import { getStoredVoiceId } from "../lib/voice";
import { useRecorder } from "../lib/useRecorder";
import AboutModal from "./AboutModal";
import RunAgentPanel from "./RunAgentPanel";
import Spinner from "./Spinner";
import StepsTrace from "./StepsTrace";

// Simple communication-turn loop:
//   idle ── Talk ──▶ recording ── Stop ──▶ thinking ──▶ review
//   review: shows the sentence + [Speak] (voice it) and [Talk] (start over)
//   review ── Speak ──▶ speaking (words draw in sync) ── ends/Stop ──▶ review
// The sentence stays on screen until Talk is pressed.
type Phase = "idle" | "recording" | "thinking" | "review" | "speaking";

export default function TalkScreen({ onChangeVoice }: { onChangeVoice: () => void }) {
  const { error, start, stop, attachPreview, startCamera, stopCamera } = useRecorder();
  const [phase, setPhase] = useState<Phase>("idle");
  const [cameraOn, setCameraOn] = useState(false); // camera is opt-in, default off
  const [text, setText] = useState("");
  const [tokens, setTokens] = useState<SpokenToken[]>([]);
  const [spoken, setSpoken] = useState(0); // count of tokens revealed so far
  const [preparing, setPreparing] = useState(false); // fetching audio
  const [recSeconds, setRecSeconds] = useState(0);
  const [apiError, setApiError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]); // trace of the last lip-read run
  const [showAgent, setShowAgent] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  // Serverless deployments can't run the VSR model; gate Talk up-front.
  const [vsrOk, setVsrOk] = useState(true);
  useEffect(() => {
    vsrAvailable().then(setVsrOk);
  }, []);

  // Transient toast notification (auto-dismisses).
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(id);
  }, [toast]);

  // Camera follows the toggle: live preview while on, released when off.
  useEffect(() => {
    if (cameraOn) {
      attachPreview(videoRef.current);
      startCamera().catch(() => {
        setApiError("Camera access is required.");
        setCameraOn(false);
      });
    } else {
      stopCamera();
      stopAudio();
      // Clear the utterance but keep apiError — it may explain why the
      // camera just turned itself off (e.g. permission denied).
      setText("");
      setTokens([]);
      setSpoken(0);
      setSteps([]);
      setPhase("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  useEffect(() => () => stopAudio(), []); // release audio on unmount

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
    setSteps([]);
    setApiError(null);
  }

  // Talk — always starts a fresh utterance (and clears the previous sentence).
  async function record() {
    if (!vsrOk) {
      setToast("Recording with the camera is available only locally - not on Vercel.");
      return;
    }
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
      const result = await executeLips(clip);
      setText(result.response);
      setSteps(result.steps);
      setPhase("review"); // show the sentence; the human confirms before voicing
    } catch (e) {
      // The backend's error envelope is human-readable (no face / no speech /
      // VSR unavailable) — show it as-is; hide only raw fetch failures.
      let msg =
        e instanceof Error && e.message && !e.message.startsWith("/api/")
          ? e.message
          : "Something went wrong. Tap Talk to try again.";
      // Cold-start race: the mount-time health check may not have resolved
      // before the user tapped Talk. Re-check so serverless deploys always
      // explain themselves instead of showing a generic failure.
      if (!(await vsrAvailable())) {
        setVsrOk(false);
        msg = "Lip-reading isn't available on this deployment - use the Run Agent button instead.";
      }
      setApiError(msg);
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
      const { audioUrl, tokens: tk } = await speak(text, getStoredVoiceId());
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

  const btnSize = cameraOn ? "sm" : "md";

  return (
    <div
      className={`fixed inset-0 overflow-hidden ${
        cameraOn ? "bg-black" : "bg-gradient-to-br from-indigo-50 via-white to-violet-100"
      }`}
    >
      {/* Full-screen camera (only while the toggle is on). `-scale-x-100`
          un-mirrors the front-camera preview so it shows the true orientation.
          Display only — the recorded clip sent to the model is unaffected. */}
      {cameraOn && (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
        />
      )}

      {/* Camera off: colorful landing — soft color glows + hero + features. */}
      {!cameraOn && (
        <>
          <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-violet-200/50 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-sky-200/50 blur-3xl" />

          {/* The copy streams onto the screen line by line (staggered fade-up). */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-16 text-center">
            <img
              src="/chaplin_logo.png"
              alt=""
              className="animate-fade-up h-24 w-24 drop-shadow-sm"
              style={{ animationDelay: "0.05s" }}
            />
            <h1
              className="animate-fade-up bg-gradient-to-r from-violet-700 via-violet-600 to-indigo-600 bg-clip-text text-5xl font-extrabold tracking-tight text-transparent"
              style={{ animationDelay: "0.25s" }}
            >
              Chaplin AI
            </h1>

            <p
              className="animate-fade-up mt-3 max-w-xl text-2xl font-semibold leading-snug text-gray-800 sm:text-3xl"
              style={{ animationDelay: "0.55s" }}
            >
              A communication agent for non-vocal, ventilated patients.
            </p>
            <p
              className="animate-fade-up max-w-lg text-lg text-gray-700 sm:text-xl"
              style={{ animationDelay: "0.95s" }}
            >
              Chaplin AI <span className="font-semibold text-violet-600">reads your lips</span>{" "}
              from a short webcam clip,
            </p>
            {/* The last two sentences stream in word by word. */}
            <StreamWords
              className="max-w-lg text-base text-gray-600 sm:text-lg"
              base={1.45}
              segments={[
                { text: "corrects", className: "font-semibold text-violet-600" },
                { text: "the noisy transcription with a reflection agent," },
              ]}
            />
            <StreamWords
              className="max-w-lg text-base text-gray-600 sm:text-lg"
              base={2.5}
              segments={[
                { text: "and" },
                { text: "speaks the sentence aloud", className: "font-semibold text-violet-600" },
                { text: "in a natural voice." },
              ]}
            />
          </div>
        </>
      )}

      {/* Dim the camera while a sentence is on screen so the words pop. */}
      {showText && <div className="absolute inset-0 z-10 bg-black/45" />}

      {/* Toast notification, top-center (auto-dismisses). */}
      {toast && (
        <div
          className="animate-pop fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 whitespace-nowrap rounded-full border border-amber-200 bg-white/95 px-4 py-2.5 shadow-[0_8px_28px_rgba(76,29,149,0.18)] backdrop-blur"
          style={{ top: "calc(env(safe-area-inset-top) + 16px)" }}
          role="status"
        >
          <WarnIcon className="shrink-0 text-amber-500" />
          <span className="text-sm font-medium text-gray-800">{toast}</span>
        </div>
      )}

      {/* Control section, top-right: Run Agent (main), Settings, Info, Camera. */}
      <div
        className={`absolute right-4 z-30 flex flex-col rounded-3xl border border-white/70 bg-white/60 backdrop-blur-2xl backdrop-saturate-[1.8] shadow-[0_8px_28px_rgba(76,29,149,0.15)] ${
          cameraOn ? "w-44 gap-1.5 p-2" : "w-60 gap-2.5 p-3"
        }`}
        style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <GlassButton
          size={btnSize}
          onClick={() => setShowAgent(true)}
          variant="primary"
          icon={<BoltIcon className="text-emerald-300" />}
          label="Run Agent"
          className="w-full"
        />
        <GlassButton
          size={btnSize}
          onClick={onChangeVoice}
          variant="ghost"
          icon={<span className="text-gray-500"><GearIcon /></span>}
          label="Settings"
          className="w-full"
        />
        <GlassButton
          size={btnSize}
          onClick={() => setShowAbout(true)}
          variant="ghost"
          icon={<span className="text-gray-500"><InfoIcon /></span>}
          label="Info"
          className="w-full"
        />
        {/* Camera on/off — same capsule look, with an Apple-style switch. */}
        <div
          className={`flex w-full items-center justify-between rounded-full border border-white/70 bg-white/85 font-semibold text-gray-900 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_4px_14px_rgba(76,29,149,0.12)] ${
            cameraOn ? "px-4 py-1 text-sm" : "px-5 py-1.5 text-base"
          }`}
        >
          <span className={`flex items-center text-gray-500 ${cameraOn ? "gap-1.5" : "gap-2"}`}>
            <CameraIcon />
            <span className="text-gray-900">Camera</span>
          </span>
          <Toggle checked={cameraOn} onChange={setCameraOn} small={cameraOn} />
        </div>
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
            <p
              className={`mb-3 text-center text-sm font-medium ${
                cameraOn ? "text-red-300" : "text-red-600"
              }`}
            >
              {error || apiError}
            </p>
          )}

          {cameraOn && phase === "idle" && (
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

          {/* How the sentence was produced — opens the agent steps trace. */}
          {phase === "review" && steps.length > 0 && (
            <button
              onClick={() => setShowTrace(true)}
              className="mx-auto mt-3 block text-center text-xs font-medium text-white/50 underline-offset-2 hover:text-white/80 hover:underline"
            >
              View agent steps ({steps.length})
            </button>
          )}
        </div>
      </div>

      {showAgent && <RunAgentPanel onClose={() => setShowAgent(false)} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {showTrace && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-gray-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="animate-pop flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/60 bg-white/95 sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-bold text-gray-900">Steps trace</h2>
              <button
                onClick={() => setShowTrace(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <StepsTrace steps={steps} />
            </div>
          </div>
        </div>
      )}
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
  size = "md",
  round = false,
  ariaLabel,
  className = "",
}: {
  onClick: () => void;
  disabled?: boolean;
  variant: "primary" | "danger" | "ghost";
  icon: React.ReactNode;
  label: string;
  size?: "sm" | "md";
  round?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const look = {
    // Main action: violet -> indigo gradient (single hue family).
    primary:
      "border-white/40 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),0_8px_24px_rgba(109,40,217,0.35)]",
    // Clean frosted-white capsule with dark text.
    ghost:
      "border-white/70 bg-white/85 text-gray-900 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_4px_14px_rgba(76,29,149,0.12)]",
    danger:
      "border-white/40 bg-red-500/85 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),0_8px_24px_rgba(220,38,38,0.35)]",
  }[variant];
  const sizing = round
    ? "h-8 w-8 text-sm"
    : size === "sm"
      ? "px-4 py-1.5 text-sm"
      : "px-8 py-2.5 text-base";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`relative flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full border font-semibold backdrop-blur-2xl backdrop-saturate-[1.8] transition active:scale-[0.97] disabled:opacity-50 ${sizing} ${look} ${className}`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent" />
      <span className={`relative flex items-center ${size === "sm" ? "gap-1.5" : "gap-2"}`}>
        {icon}
        {label}
      </span>
    </button>
  );
}

// One landing sentence that streams onto the screen word by word.
function StreamWords({
  segments,
  base,
  step = 0.12,
  className = "",
}: {
  segments: { text: string; className?: string }[];
  base: number;
  step?: number;
  className?: string;
}) {
  let i = 0;
  return (
    <p className={className}>
      {segments.map((seg, si) =>
        seg.text.split(" ").map((w, wi) => (
          <span
            key={`${si}-${wi}`}
            className={`animate-fade-up inline-block ${seg.className || ""}`}
            style={{ animationDelay: `${(base + i++ * step).toFixed(2)}s` }}
          >
            {w}
            {" "}
          </span>
        ))
      )}
    </p>
  );
}

// Apple-style switch: green track when on, white knob sliding across.
function Toggle({
  checked,
  onChange,
  small = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  small?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label="Camera"
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 rounded-full transition-colors duration-200 ${
        small ? "h-6 w-10" : "h-7 w-12"
      } ${checked ? "bg-green-500" : "bg-gray-300"}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 rounded-full bg-white shadow-md transition-transform duration-200 ${
          small ? "h-5 w-5" : "h-6 w-6"
        } ${checked ? (small ? "translate-x-4" : "translate-x-5") : ""}`}
      />
    </button>
  );
}

/* — inline icons (no icon dependency) — */
const RecordDot = () => <span className="h-3 w-3 rounded-full bg-red-500" />;
const GearIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const InfoIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);
const CameraIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);
const WarnIcon = ({ className = "" }: { className?: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const BoltIcon = ({ className = "" }: { className?: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
  </svg>
);
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
