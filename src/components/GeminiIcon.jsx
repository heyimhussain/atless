import { useId } from "react";

// Classic sparkles silhouette in Google colors: the big star carries a
// blue/red/yellow/green gradient stroke, with a solid red plus and green
// dot for accents.
export default function GeminiIcon({ size = 15, className = "" }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gid = `gem-${id}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient
          id={gid}
          x1="3"
          y1="3"
          x2="21"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#4285F4" />
          <stop offset="0.33" stopColor="#34A853" />
          <stop offset="0.66" stopColor="#FBBC05" />
          <stop offset="1" stopColor="#EA4335" />
        </linearGradient>
      </defs>
      <path
        d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"
        stroke={`url(#${gid})`}
      />
      <path d="M20 2v4" stroke="#EA4335" />
      <path d="M22 4h-4" stroke="#EA4335" />
      <circle cx="4" cy="20" r="2" stroke="#34A853" />
    </svg>
  );
}
