import { architectureUrl } from "../lib/api";

/** Logo + short explanation of the system, its architecture, and how to use it. */
export default function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-gray-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="animate-pop flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/60 bg-white/95 sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <img src="/chaplin_logo.png" alt="Chaplin AI" className="h-9 w-9" />
            <h2 className="text-lg font-bold text-gray-900">About Chaplin AI</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-gray-600">
          <p>
            <strong className="text-gray-900">Chaplin AI</strong> helps non-vocal, ventilated
            patients communicate: it lip-reads them from the camera and speaks the result
            back in a natural voice.
          </p>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Architecture
            </div>
            <p className="mt-1">
              A webcam clip is transcribed by the <Chip c="amber">vsr</Chip> model
              (Auto-AVSR). A LangGraph <em>reflection</em> agent then corrects the noisy
              transcription: <Chip c="violet">generate</Chip> proposes a corrected sentence
              and <Chip c="sky">reflect</Chip> reviews it, requesting at most one revision,
              before returning the final response with a full steps trace.
            </p>
            <img
              src={architectureUrl}
              alt="Architecture diagram"
              className="mt-3 w-full rounded-xl border border-gray-200 bg-white"
            />
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              How to enter input
            </div>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                <strong className="text-gray-900">Talk</strong> - turn the camera on and
                record a short clip of yourself speaking silently; the sentence appears on
                screen and can be spoken aloud with{" "}
                <strong className="text-gray-900">Speak</strong>.
              </li>
              <li>
                <strong className="text-gray-900">Run Agent</strong> - type (or pick a
                preset) noisy transcription as text; the agent corrects it and shows every
                step it took.
              </li>
            </ul>
          </div>

          <div className="border-t border-gray-200 pt-4 text-center">
            <p className="text-base font-semibold text-gray-900">Adam Sion &amp; Jonathan Eshel</p>
            <p className="mt-0.5 text-sm text-gray-500">Chaplin AI</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const CHIP: Record<string, string> = {
  amber: "bg-amber-100 text-amber-700 border-amber-300",
  violet: "bg-violet-100 text-violet-700 border-violet-300",
  sky: "bg-sky-100 text-sky-700 border-sky-300",
};

function Chip({ c, children }: { c: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${CHIP[c]}`}>
      {children}
    </span>
  );
}
