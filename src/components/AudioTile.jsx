import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { GripHorizontal, X, Play, Pause, Mic, Pencil, Loader2 } from "lucide-react";
import TileName, { NameHint } from "./TileName.jsx";

function fmt(s) {
  if (!isFinite(s) || s == null || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function AudioTile({ tile, scale, selected, busy, leaving, onChange, onDelete, onDraggingTile, onTileMouseDown, onTileDragStart, onTileDrag, onTileDragStop, onTileContextMenu }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [renaming, setRenaming] = useState(false);

  const commitName = (v) => {
    setRenaming(false);
    if (v !== null && v !== (tile.name || "")) onChange(tile.id, { name: v });
  };

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onMeta = () => setDuration(el.duration);
    const onTime = () => setCurrent(el.currentTime);
    const onEnd = () => setPlaying(false);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, [tile.src]);

  const toggle = (e) => {
    e?.stopPropagation();
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    }
  };

  const seek = (e) => {
    e.stopPropagation();
    const el = audioRef.current;
    if (!el || !isFinite(el.duration) || el.duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    setCurrent(el.currentTime);
  };

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <Rnd
      size={{ width: tile.w, height: tile.h }}
      position={{ x: tile.x, y: tile.y }}
      scale={scale}
      minWidth={230}
      minHeight={120}
      dragHandleClassName="tile-drag-handle"
      cancel=".no-drag"
      className="tile-rnd"
      enableResizing={
        tile.transcript
          ? {
              top: true,
              right: true,
              bottom: true,
              left: true,
              topRight: true,
              bottomRight: true,
              bottomLeft: true,
              topLeft: true,
            }
          : {
              // Untranscribed tiles keep a fixed height — horizontal only.
              top: false,
              right: true,
              bottom: false,
              left: true,
              topRight: false,
              bottomRight: false,
              bottomLeft: false,
              topLeft: false,
            }
      }
      onDragStart={(e, data) => onTileDragStart(tile.id, e, data)}
      onDrag={(e, data) => onTileDrag(tile.id, e, data)}
      onDragStop={(e, d) => onTileDragStop(tile.id, e, d)}
      onResizeStart={() => onDraggingTile?.(true)}
      onResizeStop={(e, dir, ref, delta, pos) => {
        onDraggingTile?.(false);
        e.stopPropagation?.();
        onChange(tile.id, {
          w: ref.offsetWidth,
          h: ref.offsetHeight,
          x: pos.x,
          y: pos.y,
        });
      }}
      style={{ zIndex: 30 }} // stacking order: text (40) > audio (30) > video (20) > photo (10)
    >
      <div
        className={`tile flex h-full w-full flex-col overflow-hidden rounded-xl bg-white/60 backdrop-blur-md transition-all duration-150 active:scale-[0.985] dark:bg-stone-900/60 ${leaving ? "animate-tile-out" : "animate-tile-in"} ${selected ? "shadow-[0_0_0_2px_rgba(59,130,246,0.8),0_8px_24px_rgba(59,130,246,0.35)] dark:shadow-[0_0_0_2px_rgba(250,160,22,0.8),0_8px_24px_rgba(250,160,22,0.35)]" : "shadow-[0_4px_20px_rgb(0,0,0,0.06)]"}`}
        onMouseDown={(e) => onTileMouseDown(tile.id, e)}
        data-tile-id={tile.id}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onTileContextMenu(tile.id, e.clientX, e.clientY);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div
          className="tile-drag-handle group flex h-7 shrink-0 cursor-move items-center justify-between border-b border-neutral-100 bg-neutral-50/80 px-2 dark:border-white/5 dark:bg-white/5"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (e.target.closest?.("button, input, textarea")) return;
            setRenaming(true);
          }}
        >
          <span className="flex max-w-[180px] min-w-0 items-center gap-1 truncate text-[11px] text-neutral-400 dark:text-stone-500">
            <GripHorizontal size={14} className="shrink-0 text-neutral-300 dark:text-stone-600" />
            <Mic size={12} className="shrink-0 text-neutral-400 dark:text-stone-500" />
            {renaming ? (
              <TileName name={tile.name} placeholder="Voice note" onCommit={commitName} />
            ) : tile.name ? (
              <span className="min-w-0 truncate font-display font-medium">{tile.name}</span>
            ) : (
              <NameHint />
            )}
            {!renaming && (
              <Pencil size={11} className="shrink-0 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-stone-600" />
            )}
          </span>
          <button
            aria-label="Delete audio"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(tile.id);
            }}
            className="no-drag flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:text-stone-500 dark:hover:bg-red-500/20 dark:hover:text-red-400"
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>

        {!tile.src ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-3 text-center">
            <FileWarning size={18} className="shrink-0 text-neutral-300 dark:text-stone-600" />
            <span className="text-[11px] leading-snug text-neutral-400 dark:text-stone-500">
              Audio too large to auto-save on this device
            </span>
          </div>
        ) : (
        <div
          className="flex h-[104px] shrink-0 items-center gap-3 px-3"
        >
          <button
            aria-label={playing ? "Pause" : "Play"}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={toggle}
            className="no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-900 text-white transition hover:bg-stone-700 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
          >
            {playing ? (
              <Pause size={16} fill="currentColor" />
            ) : (
              <Play size={16} fill="currentColor" className="ml-0.5" />
            )}
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration || 0)}
              aria-valuenow={Math.round(current)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={seek}
              className="no-drag h-1.5 w-full cursor-pointer overflow-hidden rounded-full bg-neutral-200 dark:bg-white/15"
            >
              <div
                className="h-full rounded-full bg-stone-900 transition-[width] duration-100 dark:bg-white"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] tabular-nums text-neutral-500 dark:text-stone-400">
              <span>{fmt(current)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>
        </div>
        )}

        {tile.transcript ? (
          <div className="no-drag min-h-0 flex-1 overflow-y-auto border-t border-neutral-100 px-3 py-1.5 text-[11px] leading-snug break-words whitespace-pre-wrap text-stone-600 dark:border-white/10 dark:text-stone-300">
            {tile.transcript}
          </div>
        ) : busy ? (
          <div className="flex shrink-0 items-center gap-1.5 border-t border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-400 dark:border-white/10 dark:text-stone-500">
            <Loader2 size={12} className="animate-spin" />
            Transcribing…
          </div>
        ) : null}

        <audio
          ref={audioRef}
          src={tile.src}
          preload="metadata"
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
    </Rnd>
  );
}
