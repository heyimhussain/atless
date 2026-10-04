import { Rnd } from "react-rnd";
import { useEffect, useRef, useState } from "react";
import { GripHorizontal, Loader2, Pencil, Square, Volume2, VolumeX, X } from "lucide-react";
import TileName, { NameHint } from "./TileName.jsx";

const TTS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
// eleven_monolingual_v1 is legacy and likely retired (422s); multilingual_v2
// is current. Switch back to "eleven_monolingual_v1" here if needed.
const TTS_MODEL_ID = "eleven_multilingual_v2";

export default function TextNote({ tile, scale, selected, onChange, onDelete, onDraggingTile, onTileMouseDown, onTileDragStart, onTileDrag, onTileDragStop, notify }) {
  const [renaming, setRenaming] = useState(false);
  const [ttsState, setTtsState] = useState("idle"); // idle | loading | playing | error
  const [ttsMessage, setTtsMessage] = useState("");
  const ttsAudioRef = useRef(null);
  const ttsUrlRef = useRef(null);
  const ttsTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
      try {
        ttsAudioRef.current?.pause();
      } catch {
        /* noop */
      }
      if (ttsUrlRef.current) {
        try {
          URL.revokeObjectURL(ttsUrlRef.current);
        } catch {
          /* noop */
        }
      }
    },
    [],
  );

  const commitName = (v) => {
    setRenaming(false);
    if (v !== null && v !== (tile.name || "")) onChange(tile.id, { name: v });
  };

  const speak = async (e) => {
    e?.stopPropagation();
    if (ttsState === "playing") {
      try {
        ttsAudioRef.current?.pause();
      } catch {
        /* noop */
      }
      setTtsState("idle");
      return;
    }
    const text = (tile.text || "").trim();
    if (!text || ttsState === "loading") return;
    const key = import.meta.env.VITE_ELEVENLABS_API_KEY;
    if (!key) {
      setTtsMessage("Missing VITE_ELEVENLABS_API_KEY — restart dev server after adding .env");
      setTtsState("error");
      ttsTimerRef.current = setTimeout(() => setTtsState("idle"), 4000);
      return;
    }
    setTtsMessage("");
    setTtsState("loading");
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${TTS_VOICE_ID}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": key,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({ text, model_id: TTS_MODEL_ID }),
        },
      );
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          const msg =
            errJson?.detail?.message || errJson?.detail || errJson?.message;
          if (msg && typeof msg === "string") detail += ` — ${msg}`;
          console.error("ElevenLabs TTS error:", res.status, errJson);
        } catch {
          console.error("ElevenLabs TTS error:", res.status);
        }
        setTtsMessage(detail);
        setTtsState("error");
        notify?.(`Read aloud failed (${detail})`);
        ttsTimerRef.current = setTimeout(() => setTtsState("idle"), 4000);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      ttsUrlRef.current = url;
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      audio.onended = () => setTtsState("idle");
      audio.onerror = () => setTtsState("error");
      setTtsState("playing");
      await audio.play();
    } catch {
      setTtsMessage("Network error — check connection");
      setTtsState("error");
      notify?.("Read aloud failed (network error — check connection)");
      ttsTimerRef.current = setTimeout(() => setTtsState("idle"), 4000);
    }
  };
  return (
    <Rnd
      size={{ width: tile.w, height: tile.h }}
      position={{ x: tile.x, y: tile.y }}
      scale={scale}
      minWidth={160}
      minHeight={120}
      dragHandleClassName="tile-drag-handle"
      cancel=".no-drag"
      className="tile-rnd"
      enableResizing={{
        top: true,
        right: true,
        bottom: true,
        left: true,
        topRight: true,
        bottomRight: true,
        bottomLeft: true,
        topLeft: true,
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
      style={{ zIndex: 40 }} // stacking order: text (40) > audio (30) > video (20) > photo (10)
    >
      <div
        className={`tile flex h-full w-full flex-col overflow-hidden rounded-xl bg-white/60 backdrop-blur-md transition-shadow duration-150 dark:bg-stone-900/60 ${selected ? "shadow-[0_0_0_2px_rgba(59,130,246,0.8),0_8px_24px_rgba(59,130,246,0.35)] dark:shadow-[0_0_0_2px_rgba(250,160,22,0.8),0_8px_24px_rgba(250,160,22,0.35)]" : "shadow-[0_4px_20px_rgb(0,0,0,0.06)]"}`}
        onMouseDown={(e) => onTileMouseDown(tile.id, e)}
        onDoubleClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* drag handle */}
        <div
          className="tile-drag-handle group flex shrink-0 cursor-move items-center justify-between border-b border-neutral-100 bg-neutral-50/80 px-2 py-1 dark:border-white/5 dark:bg-white/5"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (e.target.closest?.("button, input, textarea")) return;
            setRenaming(true);
          }}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-neutral-300 dark:text-stone-600">
            <GripHorizontal size={14} className="shrink-0" />
            {renaming ? (
              <TileName name={tile.name} placeholder="Name…" onCommit={commitName} />
            ) : tile.name ? (
              <span className="min-w-0 max-w-[140px] truncate text-[11px] text-neutral-400 dark:text-stone-500">
                {tile.name}
              </span>
            ) : (
              <NameHint />
            )}
            {!renaming && (
              <Pencil size={11} className="shrink-0 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-stone-600" />
            )}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
          <button
            aria-label={ttsState === "playing" ? "Stop preview" : "Read aloud"}
            title={
              ttsState === "playing"
                ? "Stop"
                : ttsState === "error" && ttsMessage
                  ? `Read aloud failed (${ttsMessage})`
                  : "Read aloud"
            }
            onMouseDown={(e) => e.stopPropagation()}
            onClick={speak}
            disabled={ttsState === "loading" || !(tile.text || "").trim()}
            className="no-drag flex h-5 w-5 items-center justify-center rounded-full text-neutral-400 transition outline-none hover:bg-neutral-100 hover:text-stone-700 disabled:opacity-40 dark:text-stone-500 dark:hover:bg-white/10 dark:hover:text-stone-200"
          >
            {ttsState === "loading" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : ttsState === "playing" ? (
              <Square size={11} fill="currentColor" />
            ) : ttsState === "error" ? (
              <VolumeX size={13} className="text-red-500" />
            ) : (
              <Volume2 size={13} />
            )}
          </button>
          <button
            aria-label="Delete note"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(tile.id);
            }}
            className="no-drag flex h-5 w-5 items-center justify-center rounded-full text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:text-stone-500 dark:hover:bg-red-500/20 dark:hover:text-red-400"
          >
            <X size={13} strokeWidth={2.5} />
          </button>
          </span>
        </div>

        {/* editable text — wraps and stays inside the tile */}
        <textarea
          autoFocus
          value={tile.text}
          onChange={(e) => onChange(tile.id, { text: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Type something…"
          rows={1}
          className="no-drag h-full max-h-full min-h-0 w-full flex-1 resize-none overflow-auto bg-transparent p-2.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-stone-800 outline-none placeholder:text-neutral-300 dark:text-stone-100 dark:placeholder:text-stone-600"
        />
      </div>
    </Rnd>
  );
}
