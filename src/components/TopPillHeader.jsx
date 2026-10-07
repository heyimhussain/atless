import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tileDisplayName } from "../lib/tileName.js";
import GeminiIcon from "./GeminiIcon.jsx";
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
  Spline,
  Waypoints,
  Heart,
  Moon,
  Sun,
  Loader2,
  Link2,
  X,
} from "lucide-react";

const THEME_KEY = "spatial-canvas-theme";

const HELP_ITEMS = [
  { icon: MousePointer2, combos: [["Shift", "Drag"]], desc: "Pan canvas" },
  { icon: ZoomIn, combos: [["Scroll"]], desc: "Zoom in / out" },
  { icon: Type, combos: [["Double-click"]], desc: "New text note" },
  { icon: ImagePlus, combos: [["Drop files"]], desc: "Add image, video, audio" },
  { icon: Link2, combos: [["Drop link"]], desc: "Embed YouTube video" },
  { icon: Mic, combos: [["Hold", "Space"], ["Toggle", "R"]], desc: "Record voice note" },
  { icon: BoxSelect, combos: [["Drag"]], desc: "Box select tiles + links" },
  { icon: MousePointerClick, combos: [["Ctrl", "Click"]], desc: "Multi-select tiles / links" },
  { icon: Layers, combos: [["Ctrl", "A"]], desc: "Select all tiles" },
  { icon: Trash2, combos: [["Del"]], desc: "Delete selected" },
  { icon: Search, combos: [["Ctrl", "F"]], desc: "Search titles, notes, transcripts" },
  { icon: Pencil, combos: [["Double-click", "Title"]], desc: "Rename tile" },
  { icon: Spline, combos: [["Right-click"], ["Connect"]], desc: "Link tiles with an arrow" },
  { icon: X, combos: [["Esc"]], desc: "Cancel connection / close menus" },
];

function connTileName(t) {
  return tileDisplayName(t);
}

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

export default function TopPillHeader({ onAskGemini, onShare, sharing, otterOn, onOtterChange, tiles = [], connections = [], onFocusConnection }) {
  const [open, setOpen] = useState(false); // mounted
  const [shown, setShown] = useState(false); // transitioned in
  const [tab, setTab] = useState("about"); // info panel tab
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );
  const helpRef = useRef(null);
  const hideTimer = useRef(null);

  const [connOpen, setConnOpen] = useState(false);
  const [connShown, setConnShown] = useState(false);
  const connTimer = useRef(null);

  const showConn = useCallback(() => {
    if (connTimer.current) {
      clearTimeout(connTimer.current);
      connTimer.current = null;
    }
    setConnOpen(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setConnShown(true));
    });
  }, []);

  const hideConn = useCallback(() => {
    setConnShown(false);
    if (connTimer.current) clearTimeout(connTimer.current);
    connTimer.current = setTimeout(() => {
      setConnOpen(false);
      connTimer.current = null;
    }, 180);
  }, []);

  const showPanel = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    hideConn();
    setTab("about");
    setOpen(true);
    // Let the mount commit before flipping the transition state.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setShown(true));
    });
  }, [hideConn]);

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
      if (connTimer.current) clearTimeout(connTimer.current);
      if (themeTimer.current) clearTimeout(themeTimer.current);
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

  const themeTimer = useRef(null);
  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    // Borrow every transition for a smooth light/dark crossover.
    const root = document.documentElement;
    root.classList.add("theming");
    root.classList.toggle("dark", next);
    if (themeTimer.current) window.clearTimeout(themeTimer.current);
    themeTimer.current = window.setTimeout(
      () => root.classList.remove("theming"),
      250,
    );
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* noop */
    }
  };

  // Easter egg: the T, R, and final S of "StormHacks" in the credits are
  // live buttons. Click all three to summon the otter; click any of them
  // again to dismiss it. Zero visual hint — that's the point.
  const EGG_INDICES = [1, 3, 9];
  const [eggLetters, setEggLetters] = useState([]);
  const handleEgg = (i) => {
    if (otterOn) {
      onOtterChange?.(false);
      setEggLetters([]);
      return;
    }
    if (eggLetters.includes(i)) return;
    const next = [...eggLetters, i];
    if (next.length === EGG_INDICES.length) {
      setEggLetters([]);
      onOtterChange?.(true);
    } else {
      setEggLetters(next);
    }
  };

  const tileMap = new Map(tiles.map((t) => [t.id, t]));

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
          aria-label="Information"
          title="Information"
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
          onClick={() => {
            hidePanel();
            if (connOpen) hideConn();
            else showConn();
          }}
          aria-expanded={connOpen}
          aria-label="Connections"
          title="Connections"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full outline-none transition-all active:scale-90 sm:h-8 sm:w-8 ${
            connOpen
              ? "bg-stone-900 text-white dark:bg-white dark:text-stone-900"
              : "bg-neutral-100 text-stone-700 hover:bg-stone-900 hover:text-white dark:bg-white/10 dark:text-stone-300 dark:hover:bg-white dark:hover:text-stone-900"
          }`}
        >
          <Waypoints size={15} />
        </button>

        <button
          onClick={onShare}
          disabled={sharing}
          aria-label="Generate link"
          title="Generate link"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-stone-700 outline-none transition-all hover:bg-stone-900 hover:text-white active:scale-90 disabled:opacity-60 sm:h-8 sm:w-8 dark:bg-white/10 dark:text-stone-300 dark:hover:bg-white dark:hover:text-stone-900"
        >
          {sharing ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Link2 size={15} />
          )}
        </button>

        <button
          onClick={onAskGemini}
          data-ask-toggle
          aria-label="Ask Gemini about this canvas"
          title="Ask Gemini"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 outline-none transition-all hover:bg-stone-900 active:scale-90 sm:h-8 sm:w-8 dark:bg-white/10 dark:hover:bg-white"
        >
          <GeminiIcon size={16} />
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
          aria-label="Information"
          className={`absolute top-[calc(100%+8px)] left-1/2 w-[min(680px,94vw)] -translate-x-1/2 rounded-2xl border border-white/60 bg-white/85 p-2 shadow-xl ring-1 ring-black/5 backdrop-blur-xl transition-all duration-200 ease-out dark:border-white/10 dark:bg-stone-900/90 dark:ring-white/10 ${
            shown
              ? "translate-y-0 scale-100 opacity-100"
              : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0"
          }`}
        >
          <div
            role="tablist"
            aria-label="Information sections"
            className="mb-1 flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-white/10"
          >
            {["about", "shortcuts"].map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-lg px-4 py-1 text-[11px] font-semibold tracking-wider uppercase transition outline-none ${
                  tab === t
                    ? "bg-white text-stone-900 shadow-sm dark:bg-white dark:text-stone-900"
                    : "text-neutral-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "about" ? (
            <div key="about" className="animate-fade-slide-in w-full px-2.5 py-2">
              <p className="text-[13px] leading-relaxed text-stone-600 dark:text-stone-300">
                Atless is an infinite spatial canvas for collecting what&apos;s
                on your mind: typed notes, images, videos, YouTube embeds,
                voice recordings with transcripts, and AI-generated summaries —
                all as movable, resizable tiles on a pannable, zoomable board
                that persists across visits.
              </p>
              <div className="mt-4 flex items-center border-t border-neutral-200/70 pt-2 dark:border-white/10">
                {/* Invisible counterweight to the GitHub button so the credits
                    stay truly centered while everything aligns on one axis. */}
                <span aria-hidden="true" className="h-8 w-8 shrink-0" />
                <div className="flex flex-1 items-center justify-center gap-1 px-2.5 pt-1 pb-1 text-center text-[11px] tracking-tight text-neutral-400 dark:text-stone-500">
                  <span>© 2026 Hussain Shah Hashmi - Made with</span>
                  <Heart size={11} fill="currentColor" className="shrink-0" />
                  <span>
                    for{" "}
                    {"StormHacks".split("").map((ch, i) =>
                      EGG_INDICES.includes(i) ? (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleEgg(i)}
                          className="cursor-pointer focus:outline-none"
                        >
                          {ch}
                        </button>
                      ) : (
                        <Fragment key={i}>{ch}</Fragment>
                      ),
                    )}{" "}
                    2026
                  </span>
                </div>
                <a
                  href="https://github.com/heyimhussain/atless"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub repository"
                  title="GitHub repository"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-stone-700 transition outline-none hover:bg-stone-900 hover:text-white dark:bg-white/10 dark:text-stone-300 dark:hover:bg-white dark:hover:text-stone-900"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                    className="h-4 w-4"
                  >
                    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                  </svg>
                </a>
              </div>
            </div>
          ) : (
            <div key="shortcuts" className="animate-fade-slide-in grid max-h-[60vh] grid-cols-1 gap-0.5 overflow-y-auto min-[480px]:grid-cols-2 lg:grid-cols-3">
              {HELP_ITEMS.map((item) => (
                <HelpItem key={item.desc} {...item} />
              ))}
            </div>
          )}
        </div>
      )}

      {connOpen &&
        createPortal(
          <div
            role="dialog"
            aria-label="Connections"
          className={`fixed top-4 right-4 z-50 w-max max-w-[min(420px,92vw)] rounded-2xl border border-white/60 bg-white/85 p-2 shadow-xl ring-1 ring-black/5 backdrop-blur-xl transition-all duration-200 ease-out dark:border-white/10 dark:bg-stone-900/90 dark:ring-white/10 ${
            connShown
              ? "translate-y-0 scale-100 opacity-100"
              : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0"
          }`}
        >
          <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase dark:text-stone-500">
            Connections
          </div>
          {connections.length === 0 ? (
            <div className="px-2.5 py-2 text-xs text-neutral-500 dark:text-stone-400">
              No connections yet.<br />
              Right-click a tile → Make connection.
            </div>
          ) : (
            <div className="max-h-[40vh] overflow-y-auto">
              {connections.map((c) => {
                const a = tileMap.get(c.from);
                const b = tileMap.get(c.to);
                if (!a || !b) return null;
                return (
                  <button
                    key={c.id}
                    onClick={() => onFocusConnection?.(c)}
                    className="flex w-full items-center gap-1.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition hover:bg-neutral-100 dark:hover:bg-white/10"
                  >
                    <span className="min-w-0 max-w-[170px] shrink truncate font-medium text-stone-700 dark:text-stone-200">
                      {connTileName(a)}
                    </span>
                    <span aria-hidden className="shrink-0 text-neutral-400 dark:text-stone-500">
                      →
                    </span>
                    <span className="min-w-0 max-w-[170px] shrink truncate font-medium text-stone-700 dark:text-stone-200">
                      {connTileName(b)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>,
        document.body,
      )}
    </header>
  );
}
