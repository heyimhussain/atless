import { useState } from "react";
import {
  MousePointer2,
  ZoomIn,
  Type,
  ImagePlus,
  Mic,
  Sparkles,
  Moon,
  Sun,
} from "lucide-react";

const THEME_KEY = "spatial-canvas-theme";

const SHORTCUTS = [
  { icon: MousePointer2, label: "Shift + Drag", hint: "to Pan" },
  { icon: ZoomIn, label: "Wheel", hint: "to Zoom" },
  { icon: Type, label: "Double-Click", hint: "to Text" },
  { icon: ImagePlus, label: "Drag & Drop", hint: "Media" },
  { icon: Mic, label: "Space / R", hint: "to Record" },
];

function ShortcutPill({ icon: Icon, label, hint }) {
  return (
    <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-neutral-200/80 bg-neutral-100/70 px-2.5 py-1 text-[11px] leading-none text-neutral-500 whitespace-nowrap lg:inline-flex dark:border-white/10 dark:bg-white/10 dark:text-stone-400">
      <Icon size={12} strokeWidth={2} className="text-neutral-400 dark:text-stone-500" />
      <span className="font-semibold text-neutral-600 dark:text-stone-200">{label}</span>
      <span>{hint}</span>
    </span>
  );
}

export default function TopPillHeader() {
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* noop */
    }
  };

  return (
    <header className="pointer-events-auto absolute top-4 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-2 overflow-hidden rounded-full border border-white/60 bg-white/70 py-2 pr-2 pl-4 shadow-[0_8px_30px_rgb(0,0,0,0.06)] ring-1 ring-black/5 backdrop-blur-xl dark:border-white/10 dark:bg-stone-900/70 dark:ring-white/10 dark:shadow-[0_8px_30px_rgb(0,0,0,0.4)]">
        <span className="flex shrink-0 items-center gap-2 pr-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-900 text-white dark:bg-white dark:text-stone-900">
            <Sparkles size={15} strokeWidth={2} />
          </span>
          <span className="text-[13px] font-semibold tracking-tight whitespace-nowrap text-stone-900 dark:text-stone-100">
            Spatial Canvas
          </span>
        </span>

        <span className="h-5 w-px shrink-0 bg-neutral-200 dark:bg-white/10" />

        <div className="flex items-center gap-1.5">
          {SHORTCUTS.map((s) => (
            <ShortcutPill key={s.label} {...s} />
          ))}
          {/* compact single pill for smaller screens — no scrolling */}
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-200/80 bg-neutral-100/70 px-2.5 py-1 text-[11px] whitespace-nowrap text-neutral-500 lg:hidden dark:border-white/10 dark:bg-white/10 dark:text-stone-400">
            <MousePointer2 size={12} className="text-neutral-400 dark:text-stone-500" />
            <span className="font-semibold text-neutral-600 dark:text-stone-200">Shift + Drag</span>
            <span>to Pan · Wheel to Zoom · Double-click for text</span>
          </span>
        </div>

        <span className="h-5 w-px shrink-0 bg-neutral-200 dark:bg-white/10" />

        <button
          onClick={toggleDark}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full outline-none transition-colors ${
            dark
              ? "bg-white/10 text-amber-300 hover:bg-white hover:text-stone-900"
              : "bg-neutral-100 text-blue-500 hover:bg-stone-900 hover:text-white"
          }`}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
