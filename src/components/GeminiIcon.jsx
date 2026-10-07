import { useId } from "react";

// Four-point Gemini-style sparkle in Google colors (blue/red/yellow/green).
// A component (not a lucide glyph) so the gradient fill works everywhere.
export default function GeminiIcon({ size = 15, className = "" }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gid = `gem-${id}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient
          id={gid}
          x1="4"
          y1="2"
          x2="20"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#4285F4" />
          <stop offset="0.35" stopColor="#EA4335" />
          <stop offset="0.68" stopColor="#FBBC05" />
          <stop offset="1" stopColor="#34A853" />
        </linearGradient>
      </defs>
      <path
        d="M12 2c.7 5.2 3.1 7.6 8.3 8.3-5.2.7-7.6 3.1-8.3 8.3-.7-5.2-3.1-7.6-8.3-8.3 5.2-.7 7.6-3.1 8.3-8.3z"
        fill={`url(#${gid})`}
      />
      <path
        d="M18.6 13.4c.3 2.1 1.3 3.1 3.4 3.4-2.1.3-3.1 1.3-3.4 3.4-.3-2.1-1.3-3.1-3.4-3.4 2.1-.3 3.1-1.3 3.4-3.4z"
        fill={`url(#${gid})`}
      />
    </svg>
  );
}
