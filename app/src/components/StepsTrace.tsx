import { Step } from "../lib/api";

// Per-module accent colors — names match the architecture diagram.
const MODULE_COLOR: Record<string, string> = {
  vsr: "bg-amber-500/20 text-amber-300 border-amber-400/30",
  generate: "bg-violet-500/20 text-violet-300 border-violet-400/30",
  reflect: "bg-sky-500/20 text-sky-300 border-sky-400/30",
};

function Field({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{label}</div>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2.5 text-xs leading-relaxed text-white/80">
        {text}
      </pre>
    </div>
  );
}

/** The full agent execution trace: one collapsible card per step. */
export default function StepsTrace({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <div className="space-y-2">
      {steps.map((step, i) => (
        <details
          key={i}
          className="group rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 open:bg-white/[0.07]"
        >
          <summary className="flex cursor-pointer select-none items-center gap-2.5 text-sm">
            <span className="text-white/35">{i + 1}</span>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                MODULE_COLOR[step.module] || "bg-white/10 text-white/70 border-white/20"
              }`}
            >
              {step.module}
            </span>
            <span className="truncate text-white/50">
              {String(
                (step.response as Record<string, unknown>).corrected ??
                  (step.response as Record<string, unknown>).verdict ??
                  (step.response as Record<string, unknown>).raw_transcription ??
                  ""
              )}
            </span>
            <span className="ml-auto text-white/30 transition group-open:rotate-90">›</span>
          </summary>
          {/* Full trace per the workshop requirements: module, prompt, response. */}
          {Object.entries(step.prompt).map(([k, v]) => (
            <Field key={k} label={`prompt - ${k}`} value={v} />
          ))}
          <Field label="response" value={step.response} />
        </details>
      ))}
    </div>
  );
}
