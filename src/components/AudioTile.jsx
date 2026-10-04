import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { GripHorizontal, X, Play, Pause, Mic, Pencil, FileText, FileWarning, Loader2 } from "lucide-react";
import TileName, { NameHint } from "./TileName.jsx";

function fmt(s) {
  if (!isFinite(s) || s == null || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function AudioTile({ tile, scale, selected, onChange, onDelete, onDraggingTile, onTileMouseDown, onTileDragStart, onTileDrag, onTileDragStop }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sttError, setSttError] = useState(null);

  const commitName = (v) => {
    setRenaming(false);
    if (v !== null && v !== (tile.name || "")) onChange(tile.id, { name: v });
  };

  const transcribe = async (e) => {
    e?.stopPropagation();
    if (transcribing || !tile.src) return;
    const key = import.meta.env.VITE_ELEVENLABS_API_KEY;
    if (!key) {
      setSttError("Missing API key");
      return;
    }
    setTranscribing(true);
    setSttError(null);
    try {
      const blob = await (await fetch(tile.src)).blob();
      const ext = blob.type.includes("mp4") || blob.type.includes("m4a")
        ? "m4a"
        : blob.type.includes("mpeg") || blob.type.includes("mp3")
          ? "mp3"
          : blob.type.includes("wav")
            ? "wav"
            : blob.type.includes("ogg") || blob.type.includes("opus")
              ? "ogg"
              : "webm";
      const form = new FormData();
      form.append("file", blob, `${tile.name || "recording"}.${ext}`);
      form.append("model_id", "scribe_v2");
      const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": key },
        body: form,
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          const msg =
            errJson?.detail?.message || errJson?.detail || errJson?.message;
          if (msg && typeof msg === "string") detail += ` — ${msg}`;
          console.error("ElevenLabs STT error:", res.status, errJson);
        } catch {
          console.error("ElevenLabs STT error:", res.status);
        }
        throw new Error(detail);
      }
      const json = await res.json();
      const text = (json?.text || "").trim();
      onChange(tile.id, {
        transcript: text,
        h: Math.max(tile.h || 0, 200),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSttError(`Transcription failed (${msg || "network error"})`);
    } finally {
      setTranscribing(false);
    }
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
      enableResizing={{
        top: false,
        right: true,
        bottom: false,
        left: true,
        topRight: false,
        bottomRight: false,
        bottomLeft: false,
        topLeft: false,
      }}
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
        className={`tile flex h-full w-full flex-col overflow-hidden rounded-xl bg-white/60 backdrop-blur-md transition-shadow duration-150 dark:bg-stone-900/60 ${selected ? "shadow-[0_0_0_2px_rgba(59,130,246,0.8),0_8px_24px_rgba(59,130,246,0.35)] dark:shadow-[0_0_0_2px_rgba(250,160,22,0.8),0_8px_24px_rgba(250,160,22,0.35)]" : "shadow-[0_4px_20px_rgb(0,0,0,0.06)]"}`}
        onMouseDown={(e) => onTileMouseDown(tile.id, e)}
        onDoubleClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div
          className="tile-drag-handle group flex shrink-0 cursor-move items-center justify-between border-b border-neutral-100 bg-neutral-50/80 px-2 py-1 dark:border-white/5 dark:bg-white/5"
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
              <span className="min-w-0 truncate">{tile.name}</span>
            ) : (
              <NameHint />
            )}
            {!renaming && (
              <Pencil size={11} className="shrink-0 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-stone-600" />
            )}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
          <button
            aria-label="Transcribe audio"
            title="Transcribe"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={transcribe}
            disabled={transcribing || !tile.src}
            className="no-drag flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-neutral-400 transition outline-none hover:bg-neutral-100 hover:text-stone-700 disabled:opacity-60 dark:text-stone-500 dark:hover:bg-white/10 dark:hover:text-stone-200"
          >
            {transcribing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <FileText size={13} />
            )}
          </button>
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
          </span>
        </div>

        {!tile.src ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-3 text-center">
            <FileWarning size={18} className="shrink-0 text-neutral-300 dark:text-stone-600" />
            <span className="text-[11px] leading-snug text-neutral-400 dark:text-stone-500">
              Audio too large to auto-save on this device
            </span>
          </div>
        ) : (
        <div className="flex min-h-0 flex-1 items-center gap-3 px-3">
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
          <div className="no-drag max-h-20 min-h-0 shrink-0 overflow-y-auto border-t border-neutral-100 px-3 py-1.5 text-[11px] leading-snug break-words whitespace-pre-wrap text-stone-600 dark:border-white/10 dark:text-stone-300">
            {tile.transcript}
          </div>
        ) : transcribing ? (
          <div className="flex shrink-0 items-center gap-1.5 border-t border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-400 dark:border-white/10 dark:text-stone-500">
            <Loader2 size={12} className="animate-spin" />
            Transcribing…
          </div>
        ) : sttError ? (
          <div className="shrink-0 border-t border-neutral-100 px-3 py-1.5 text-[11px] text-red-500 dark:border-white/10">
            {sttError}
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
