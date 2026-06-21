// Clean, minimal spinner. `light` for use on dark/overlay backgrounds.
export default function Spinner({
  size = 20,
  light = false,
  className = "",
}: {
  size?: number;
  light?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
      aria-label="Loading"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke={light ? "rgba(255,255,255,0.3)" : "rgba(16,24,40,0.15)"}
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke={light ? "#ffffff" : "#6938ef"}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
