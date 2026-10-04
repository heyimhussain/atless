import { Rnd } from "react-rnd";
import { useState } from "react";
import { GripHorizontal, Pencil, X } from "lucide-react";
import TileName, { NameHint } from "./TileName.jsx";

export default function TextNote({ tile, scale, selected, leaving, onChange, onDelete, onDraggingTile, onTileMouseDown, onTileDragStart, onTileDrag, onTileDragStop, onTileContextMenu }) {
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
        className={`tile flex h-full w-full flex-col overflow-hidden rounded-xl bg-white/60 backdrop-blur-md transition-all duration-150 active:scale-[0.985] dark:bg-stone-900/60 ${leaving ? "animate-tile-out" : "animate-tile-in"} ${selected ? "shadow-[0_0_0_2px_rgba(59,130,246,0.8),0_8px_24px_rgba(59,130,246,0.35)] dark:shadow-[0_0_0_2px_rgba(250,160,22,0.8),0_8px_24px_rgba(250,160,22,0.35)]" : "shadow-[0_4px_20px_rgb(0,0,0,0.06)]"}`}
        onMouseDown={(e) => onTileMouseDown(tile.id, e)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onTileContextMenu(tile.id, e.clientX, e.clientY);
        }}
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
              <span className="min-w-0 max-w-[140px] truncate font-display text-[11px] font-medium text-neutral-400 dark:text-stone-500">
                {tile.name}
              </span>
            ) : (
              <NameHint />
            )}
            {!renaming && (
              <Pencil size={11} className="shrink-0 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-stone-600" />
            )}
          </span>
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
