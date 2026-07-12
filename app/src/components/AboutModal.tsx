import { architectureUrl } from "../lib/api";

/** Logo + short explanation of the system, its architecture, and how to use it. */
export default function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="animate-pop flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-900/95 sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <img src="/chaplin_logo.png" alt="Chaplin AI" className="h-9 w-9 rounded-xl" />
            <h2 className="text-lg font-bold text-white">About Chaplin AI</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-white/75">
          <p>
            <strong className="text-white">Chaplin AI</strong> helps non-vocal, ventilated
            patients communicate: it lip-reads them from the camera and speaks the result
            back in a natural voice.
          </p>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-white/40">
              Architecture
            </div>
            <p className="mt-1">
              A webcam clip is transcribed by the <Chip c="amber">vsr</Chip> model
              (Auto-AVSR). A LangGraph <em>reflection</em> agent then corrects the noisy
              transcription: <Chip c="violet">generate</Chip> proposes a corrected sentence
              and <Chip c="sky">reflect</Chip> reviews it — requesting at most one revision —
              before returning the final response with a full steps trace.
            </p>
            <img
              src={architectureUrl}
              alt="Architecture diagram"
              className="mt-3 w-full rounded-xl border border-white/10 bg-white"
            />
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-white/40">
              How to enter input
            </div>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                <strong className="text-white">Talk</strong> — record a short clip of
                yourself speaking silently to the camera; the sentence appears on screen and
                can be spoken aloud with <strong className="text-white">Speak</strong>.
              </li>
              <li>
                <strong className="text-white">Run Agent</strong> — type (or pick a preset)
                noisy transcription as text; the agent corrects it and shows every step it
                took.
              </li>
            </ul>
          </div>

          <p className="text-xs text-white/40">
            Privacy: video is processed locally and deleted right after inference — only
            text leaves the device.
          </p>
        </div>
      </div>
    </div>
  );
}

const CHIP: Record<string, string> = {
  amber: "bg-amber-500/20 text-amber-300 border-amber-400/30",
  violet: "bg-violet-500/20 text-violet-300 border-violet-400/30",
  sky: "bg-sky-500/20 text-sky-300 border-sky-400/30",
};

function Chip({ c, children }: { c: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${CHIP[c]}`}>
      {children}
    </span>
  );
}
