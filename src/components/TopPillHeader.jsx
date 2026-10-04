import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  ZoomIn,
  Type,
  ImagePlus,
  Mic,
  Search,
  BoxSelect,
  MousePointerClick,
  Layers,
  Trash2,
  Pencil,
  Moon,
  Sun,
  Sparkles,
  Loader2,
  Link2,
} from "lucide-react";

const THEME_KEY = "spatial-canvas-theme";

const HELP_ITEMS = [
  { icon: MousePointer2, combos: [["Shift", "Drag"]], desc: "Pan canvas" },
  { icon: ZoomIn, combos: [["Scroll"]], desc: "Zoom in / out" },
  { icon: Type, combos: [["Double-click"]], desc: "New text note" },
  { icon: ImagePlus, combos: [["Drop files"]], desc: "Add image, video, audio" },
  { icon: Link2, combos: [["Drop link"]], desc: "Embed YouTube video" },
  { icon: Mic, combos: [["Hold", "Space"], ["Toggle", "R"]], desc: "Record voice note" },
  { icon: BoxSelect, combos: [["Drag"]], desc: "Box select tiles" },
  { icon: MousePointerClick, combos: [["Ctrl", "Click"]], desc: "Multi-select" },
  { icon: Layers, combos: [["Ctrl", "A"]], desc: "Select all tiles" },
  { icon: Trash2, combos: [["Del"]], desc: "Delete selected" },
  { icon: Search, combos: [["Ctrl", "F"]], desc: "Search tiles" },
  { icon: Pencil, combos: [["Double-click", "Title"]], desc: "Rename tile" },
];

function HelpItem({ icon: Icon, combos, desc }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-stone-300">
        <Icon size={13} />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        {combos.map((combo, ci) => (
          <span key={ci} className="flex flex-wrap items-center gap-1">
            {combo.map((k, i) => (
              <Fragment key={k}>
                {i > 0 && (
                  <span className="text-[10px] text-neutral-400 dark:text-stone-500">
                    +
                  </span>
                )}
                <kbd className="rounded-md border border-neutral-200 bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold whitespace-nowrap text-stone-700 dark:border-white/10 dark:bg-white/10 dark:text-stone-200">
                  {k}
                </kbd>
              </Fragment>
            ))}
          </span>
        ))}
        <span className="text-[11px] whitespace-nowrap text-neutral-500 dark:text-stone-400">
          {desc}
        </span>
      </span>
    </div>
  );
}

export default function TopPillHeader({ onSummarize, summarizing }) {
  const [open, setOpen] = useState(false); // mounted
  const [shown, setShown] = useState(false); // transitioned in
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );
  const helpRef = useRef(null);
  const hideTimer = useRef(null);

  const showPanel = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setOpen(true);
    // Let the mount commit before flipping the transition state.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setShown(true));
    });
  }, []);

  const hidePanel = useCallback(() => {
    setShown(false);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setOpen(false);
      hideTimer.current = null;
    }, 180);
  }, []);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  // Outside click / Escape dismisses.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (!helpRef.current?.contains(e.target)) hidePanel();
    };
    const onKey = (e) => {
      if (e.key === "Escape") hidePanel();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, hidePanel]);

  // "?" toggles the guide (never while typing).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== "?") return;
      const el = e.target;
      if (el?.closest?.("textarea, input, select, [contenteditable]")) return;
      e.preventDefault();
      if (helpRef.current?.dataset.open === "1") hidePanel();
      else showPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hidePanel, showPanel]);

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
    <header ref={helpRef} data-open={open ? "1" : "0"} className="pointer-events-auto absolute top-4 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-1.5 overflow-hidden rounded-full border border-white/60 bg-white/70 py-1.5 pr-1.5 pl-3 shadow-[0_8px_30px_rgb(0,0,0,0.06)] ring-1 ring-black/5 backdrop-blur-xl sm:gap-2 sm:py-2 sm:pr-2 sm:pl-4 dark:border-white/10 dark:bg-stone-900/70 dark:ring-white/10 dark:shadow-[0_8px_30px_rgb(0,0,0,0.4)]">
        <span className="flex shrink-0 items-center gap-2 pr-1">
          <svg
            viewBox="0 0 64 64"
            fill="none"
            aria-hidden
            className="h-6 w-6 shrink-0 text-stone-900 sm:h-7 sm:w-7 dark:text-stone-100"
          >
            <rect x="30.75" y="10" width="2.5" height="36" rx="1.25" fill="currentColor" />
            <path d="M34.5 12 L34.5 42 L52 42 Z" fill="currentColor" />
            <path d="M29.5 18 L29.5 42 L12 42 Z" fill="currentColor" />
            <path d="M20 49 Q28 41 36 49 T52 49" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          </svg>
          <span className="font-display text-xs font-medium tracking-tight whitespace-nowrap text-stone-900 sm:text-[13px] dark:text-stone-100">
            Atless
          </span>
        </span>

        <span className="h-5 w-px shrink-0 bg-neutral-200 dark:bg-white/10" />

        <button
          onClick={() => (open ? hidePanel() : showPanel())}
          aria-expanded={open}
          aria-label="Show shortcuts"
          title="Shortcuts"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full outline-none transition-all active:scale-90 sm:h-8 sm:w-8 ${
            open
              ? "bg-stone-900 text-white dark:bg-white dark:text-stone-900"
              : "bg-neutral-100 text-stone-700 hover:bg-stone-900 hover:text-white dark:bg-white/10 dark:text-stone-300 dark:hover:bg-white dark:hover:text-stone-900"
          }`}
        >
          <span aria-hidden className="font-display text-[15px] font-semibold leading-none">
            ?
          </span>
        </button>

        <button
          onClick={onSummarize}
          disabled={summarizing}
          aria-label="Summarize canvas with Gemini"
          title="Summarize with Gemini"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-stone-700 outline-none transition-all hover:bg-stone-900 hover:text-white active:scale-90 disabled:opacity-60 sm:h-8 sm:w-8 dark:bg-white/10 dark:text-stone-300 dark:hover:bg-white dark:hover:text-stone-900"
        >
          {summarizing ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Sparkles size={15} />
          )}
        </button>

        <button
          onClick={toggleDark}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full outline-none transition-all active:scale-90 sm:h-8 sm:w-8 ${
            dark
              ? "bg-white/10 text-[rgb(250,160,22)] hover:bg-white hover:text-stone-900"
              : "bg-neutral-100 text-blue-500 hover:bg-stone-900 hover:text-white"
          }`}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Keyboard shortcuts"
          className={`absolute top-[calc(100%+8px)] left-1/2 w-max max-w-[92vw] -translate-x-1/2 rounded-2xl border border-white/60 bg-white/85 p-2 shadow-xl ring-1 ring-black/5 backdrop-blur-xl transition-all duration-200 ease-out dark:border-white/10 dark:bg-stone-900/90 dark:ring-white/10 ${
            shown
              ? "translate-y-0 scale-100 opacity-100"
              : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0"
          }`}
        >
          <div className="grid max-h-[60vh] grid-cols-1 gap-0.5 overflow-y-auto min-[480px]:grid-cols-2 lg:grid-cols-3">
            {HELP_ITEMS.map((item) => (
              <HelpItem key={item.desc} {...item} />
            ))}
          </div>
          <div className="mt-1 border-t border-neutral-200/70 px-2.5 pt-2 pb-1 text-center text-[11px] tracking-tight text-neutral-400 dark:border-white/10 dark:text-stone-500">
            © 2026 Hussain Shah Hashmi - Designed with React & Vite.
          </div>
        </div>
      )}
    </header>
  );
}
