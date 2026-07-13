import { useState } from "react";
import { executeText, ExecuteResult } from "../lib/api";
import Spinner from "./Spinner";
import StepsTrace from "./StepsTrace";

// Deliberately incorrect, VSR-style (all-caps) sentences the agent corrects.
const PRESETS = [
  "IM SO EXCITED TO ME YOU TODAY",
  "PLEASE BRING ME A GLASS OF WHAT ER",
  "CAN YOU TURN OF THE LIGHT PLEASE",
  "I FILL A LOT OF PAIN IN MY BAG",
  "I WOULD LIKE TO SEA MY FAMILY TO MORROW",
  "THANK YOU DARLING YOU ARE JUST TOO KIND TO DAY",
];

/** Text entry point to the agent: presets dropdown + free text -> /api/execute. */
export default function RunAgentPanel({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await executeText(prompt.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-gray-900/40 px-4 pb-4 backdrop-blur-sm sm:items-center sm:p-6"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}
    >
      <div className="animate-pop flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/95 sm:max-h-[92vh]">
        {/* header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Run Agent</h2>
            <p className="text-xs text-gray-500">
              Send a noisy transcription as text - no camera needed.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {/* preset picker */}
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Preset incorrect sentences
          </label>
          <div className="relative mt-1.5">
            <select
              value={PRESETS.includes(prompt) ? prompt : ""}
              onChange={(e) => e.target.value && setPrompt(e.target.value)}
              className="w-full appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-3.5 pr-10 text-sm text-gray-900 outline-none focus:border-violet-500"
            >
              <option value="">Choose a preset…</option>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400"
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          {/* free text */}
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-gray-400">
            Or enter any text to correct
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="E.G. IM SO EXCITED TO ME YOU TODAY"
            className="mt-1.5 w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-violet-500"
          />

          <button
            onClick={run}
            disabled={!prompt.trim() || running}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-base font-bold text-white shadow-[0_8px_24px_rgba(109,40,217,0.3)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            {running ? <Spinner size={20} light /> : <BoltIcon />}
            {running ? "Running…" : "Run Agent"}
          </button>

          {error && (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* final response */}
          {result && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Agent response
              </div>
              <p className="animate-pop mt-1.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-lg font-semibold text-green-700">
                {result.response}
              </p>

              <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Steps trace · {result.steps.length} calls
              </div>
              <div className="mt-1.5">
                <StepsTrace steps={result.steps} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const BoltIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
  </svg>
);
