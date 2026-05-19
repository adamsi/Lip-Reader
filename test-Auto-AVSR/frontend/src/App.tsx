import { useCallback, useEffect, useRef, useState } from "react";

type TranscriptionResponse = {
  top_k: Array<{
    rank: number;
    text: string;
    score: number | null;
  }>;
};

const SUPPORTED_VIDEO_EXTENSIONS = [".mp4", ".m4v", ".mov", ".avi", ".mkv", ".webm", ".mpeg", ".mpg"];

function isSupportedVideoFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  if (SUPPORTED_VIDEO_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return true;
  return file.type.startsWith("video/");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function scorePercent(score: number | null, maxScore: number): number | null {
  if (score == null || maxScore <= 0) return null;
  return Math.max(8, Math.round((score / maxScore) * 100));
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TranscriptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000/transcribe";

  const applyFile = useCallback((next: File | null) => {
    setFile(next);
    setResult(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onFileChange(next: File | null) {
    if (next && !isSupportedVideoFile(next)) {
      setError("Please choose a supported video file, such as MP4, MPG, MOV, AVI, MKV, or WebM.");
      return;
    }
    applyFile(next);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) onFileChange(dropped);
  }

  async function handleSubmit() {
    if (!file) {
      setError("Drop or choose a video clip first.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(apiUrl, {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        const detail =
          typeof payload.detail === "string"
            ? payload.detail
            : JSON.stringify(payload.detail ?? payload, null, 2);
        throw new Error(detail);
      }

      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  const top = result?.top_k[0];
  const alternatives = result?.top_k.slice(1) ?? [];
  const maxScore =
    result?.top_k.reduce((max, item) => {
      if (item.score == null) return max;
      return Math.max(max, item.score);
    }, 0) ?? 0;

  return (
    <div className="app">
      <div className="bg-grid" aria-hidden />
      <div className="bg-glow bg-glow--left" aria-hidden />
      <div className="bg-glow bg-glow--right" aria-hidden />

      <main className="shell">
        <header className="hero">
          <span className="badge">Auto-AVSR</span>
          <h1>
            Read lips,
            <em> context based</em>
          </h1>
          <p className="lede">
            Upload a short talking-head clip. The model tracks the face and decodes what was
            said—locally, on your machine.
          </p>
        </header>

        <section className="card upload-card">
          <div
            className={`dropzone${dragOver ? " dropzone--active" : ""}${file ? " dropzone--filled" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Upload video"
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/*,.mp4,.m4v,.mov,.avi,.mkv,.webm,.mpeg,.mpg"
              className="sr-only"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />

            {!file ? (
              <div className="dropzone-empty">
                <div className="dropzone-icon" aria-hidden>
                  <svg viewBox="0 0 48 48" fill="none">
                    <rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="2" />
                    <path d="M18 22l6 5 6-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M24 27v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="dropzone-title">Drop your video here</p>
                <p className="dropzone-sub">or click to browse · frontal, well-lit clips work best</p>
              </div>
            ) : (
              <div className="dropzone-filled">
                {previewUrl ? (
                  <video className="preview" src={previewUrl} muted playsInline />
                ) : null}
                <div className="file-meta">
                  <div className="file-info">
                    <span className="file-name">{file.name}</span>
                    <span className="file-size">{formatBytes(file.size)}</span>
                  </div>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      applyFile(null);
                      if (inputRef.current) inputRef.current.value = "";
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="actions">
            <button
              type="button"
              className="primary-btn"
              onClick={handleSubmit}
              disabled={loading || !file}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden />
                  Transcribing…
                </>
              ) : (
                "Transcribe video"
              )}
            </button>
          </div>
        </section>

        {error ? (
          <section className="card result-card result-card--error" role="alert">
            <h2 className="result-label">Something went wrong</h2>
            <pre className="error-text">{error}</pre>
          </section>
        ) : null}

        {result && top ? (
          <section className="card result-card" aria-live="polite">
            <h2 className="result-label">Best guess</h2>
            <blockquote className="transcript-primary">&ldquo;{top.text}&rdquo;</blockquote>
            {top.score != null ? (
              <p className="score-note">Beam score · relative ranking only</p>
            ) : null}

            {alternatives.length > 0 ? (
              <>
                <h3 className="alt-heading">Other candidates</h3>
                <ul className="alt-list">
                  {alternatives.map((item) => {
                    const pct = scorePercent(item.score, maxScore);
                    return (
                      <li key={item.rank} className="alt-item">
                        <span className="alt-rank">#{item.rank}</span>
                        <div className="alt-body">
                          <p className="alt-text">{item.text}</p>
                          {pct != null ? (
                            <div className="score-bar" aria-hidden>
                              <span className="score-bar-fill" style={{ width: `${pct}%` }} />
                            </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        <footer className="footer">
          <p>Decoder beam scores are not calibrated probabilities.</p>
        </footer>
      </main>
    </div>
  );
}
