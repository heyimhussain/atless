import { Rnd } from "react-rnd";
import { useState } from "react";
import { GripHorizontal, Pencil, X } from "lucide-react";
import TileName, { NameHint } from "./TileName.jsx";

// Height of the tile's top drag-handle bar. The media area keeps the exact
// photo/video ratio by excluding this chrome from the aspect lock
// (see lockAspectRatioExtraHeight below) and adding it to probed tile sizes.
export const MEDIA_HEADER_H = 28;

export default function MediaTile({ tile, scale, selected, onChange, onDelete, onDraggingTile, onTileMouseDown, onTileDragStart, onTileDrag, onTileDragStop }) {
  const isVideo = tile.type === "video";
  const [renaming, setRenaming] = useState(false);

  const commitName = (v) => {
    setRenaming(false);
    if (v !== null && v !== (tile.name || "")) onChange(tile.id, { name: v });
  };

  return (
    <Rnd
      size={{ width: tile.w, height: tile.h }}
      position={{ x: tile.x, y: tile.y }}
      scale={scale}
      minWidth={120}
      minHeight={90}
      dragHandleClassName="tile-drag-handle"
      cancel=".no-drag"
      className="tile-rnd"
      // Lock to the file's true probed ratio (not the live box, which may
      // carry rounding error) — header height excluded, see below.
      lockAspectRatio={tile.ratio ?? tile.w / tile.h}
      lockAspectRatioExtraHeight={MEDIA_HEADER_H}
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
      // stacking order: text (40) > audio (30) > video (20) > photo (10)
      style={{ zIndex: tile.type === "video" ? 20 : 10 }}
    >
      <div
        className={`tile flex h-full w-full flex-col overflow-hidden rounded-xl bg-white transition-shadow duration-150 dark:bg-stone-900 ${selected ? "shadow-[0_0_0_2px_rgba(59,130,246,0.8),0_8px_24px_rgba(59,130,246,0.35)] dark:shadow-[0_0_0_2px_rgba(250,160,22,0.8),0_8px_24px_rgba(250,160,22,0.35)]" : "shadow-[0_4px_20px_rgb(0,0,0,0.06)]"}`}
        onMouseDown={(e) => onTileMouseDown(tile.id, e)}
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
            {renaming ? (
              <TileName name={tile.name} placeholder={tile.type} onCommit={commitName} />
            ) : tile.name ? (
              <span className="min-w-0 truncate">{tile.name}</span>
            ) : (
              <NameHint />
            )}
            {!renaming && (
              <Pencil size={11} className="shrink-0 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-stone-600" />
            )}
          </span>
          <button
            aria-label={`Delete ${tile.type}`}
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

        <div className="min-h-0 w-full flex-1 bg-neutral-100 dark:bg-black/50">
          {isVideo ? (
            <video
              src={tile.src}
              controls
              preload="metadata"
              className="no-drag h-full w-full object-cover"
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={tile.src}
              alt={tile.name || "canvas image"}
              draggable={false}
              className="h-full w-full object-cover select-none"
            />
          )}
        </div>
      </div>
    </Rnd>
  );
}
