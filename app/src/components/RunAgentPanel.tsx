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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="animate-pop flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-900/95 sm:rounded-3xl">
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-white">Run Agent</h2>
            <p className="text-xs text-white/50">
              Send a noisy transcription as text — no camera needed.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {/* preset picker */}
          <label className="text-xs font-semibold uppercase tracking-wide text-white/40">
            Preset incorrect sentences
          </label>
          <select
            value={PRESETS.includes(prompt) ? prompt : ""}
            onChange={(e) => e.target.value && setPrompt(e.target.value)}
            className="mt-1.5 w-full appearance-none rounded-xl border border-white/15 bg-zinc-800 px-3.5 py-2.5 text-sm text-white outline-none focus:border-violet-400"
          >
            <option value="">Choose a preset…</option>
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {/* free text */}
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-white/40">
            Or enter any text to correct
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="E.G. IM SO EXCITED TO ME YOU TODAY"
            className="mt-1.5 w-full resize-none rounded-xl border border-white/15 bg-zinc-800 px-3.5 py-2.5 text-sm text-white placeholder-white/25 outline-none focus:border-violet-400"
          />

          <button
            onClick={run}
            disabled={!prompt.trim() || running}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3 text-base font-bold text-white transition hover:bg-violet-500 active:scale-[0.98] disabled:opacity-40"
          >
            {running ? <Spinner size={20} light /> : <BoltIcon />}
            {running ? "Running…" : "Run Agent"}
          </button>

          {error && (
            <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
              {error}
            </p>
          )}

          {/* final response */}
          {result && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/40">
                Agent response
              </div>
              <p className="animate-pop mt-1.5 rounded-xl border border-green-400/25 bg-green-500/10 px-4 py-3 text-lg font-semibold text-green-200">
                {result.response}
              </p>

              <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-white/40">
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
