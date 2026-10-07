import { Download, FileText, Loader2, Spline, Square, Trash2, Volume2 } from "lucide-react";
import GeminiIcon from "./GeminiIcon.jsx";

function MenuButton({ icon: Icon, label, onClick, disabled, spin, danger, rainbow }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium transition outline-none disabled:opacity-60 ${
        danger
          ? "text-red-500 hover:bg-red-500/10 dark:text-red-400"
          : "text-stone-700 hover:bg-neutral-100 dark:text-stone-200 dark:hover:bg-white/10"
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          rainbow
            ? "bg-transparent"
            : "bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-stone-400"
        }`}
      >
        {spin ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Icon size={13} />
        )}
      </span>
      {rainbow ? (
        <span className="bg-[linear-gradient(to_right,#2563eb,#16a34a,#ca8a04,#dc2626)] bg-clip-text text-transparent dark:bg-[linear-gradient(to_right,#93c5fd,#86efac,#fde047,#fca5a5)]">
          {label}
        </span>
      ) : (
        label
      )}
    </button>
  );
}

// Floating right-click menu for a single tile. Positioned at the cursor
// (clamped into the viewport by the caller).
export default function TileMenu({
  x,
  y,
  tile,
  playing,
  busy,
  shown,
  onSpeak,
  onTranscribe,
  onDownload,
  onAsk,
  onConnect,
  onDelete,
}) {
  const left = Math.max(8, Math.min(x, window.innerWidth - 228));
  const top = Math.max(8, Math.min(y, window.innerHeight - 160));

  return (
    <div
      role="menu"
      aria-label={`${tile.type} tile actions`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className={`tile-menu fixed z-[60] w-56 rounded-2xl border border-white/60 bg-white/85 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur-xl transition-all duration-150 origin-top-left dark:border-white/10 dark:bg-stone-900/90 dark:ring-white/10 ${
        shown ? "scale-100 opacity-100" : "pointer-events-none scale-[0.97] opacity-0"
      }`}
      style={{ left, top }}
    >
      {tile.type === "text" && (
        <MenuButton
          icon={playing ? Square : Volume2}
          label={playing ? "Stop preview" : "Read aloud"}
          onClick={onSpeak}
        />
      )}
      {tile.type === "audio" && (
        <>
          <MenuButton
            icon={FileText}
            label={busy ? "Transcribing…" : "Transcribe"}
            onClick={onTranscribe}
            disabled={busy || !tile.src}
            spin={busy}
          />
          <MenuButton
            icon={Download}
            label="Download recording"
            onClick={onDownload}
            disabled={!tile.src}
          />
        </>
      )}
      <MenuButton icon={Spline} label="Make connection" onClick={onConnect} />
      <MenuButton icon={GeminiIcon} label="Ask Gemini" rainbow onClick={onAsk} />
      <MenuButton icon={Trash2} label="Delete" danger onClick={onDelete} />
    </div>
  );
}
