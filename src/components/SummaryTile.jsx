import { Rnd } from "react-rnd";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import TileName, { NameHint } from "./TileName.jsx";
import GeminiIcon from "./GeminiIcon.jsx";
import { highlightParts } from "../lib/highlight.jsx";

export default function SummaryTile({ tile, scale, selected, leaving, onChange, onDelete, onDraggingTile, onTileMouseDown, onTileDragStart, onTileDrag, onTileDragStop, onTileResize, onTileContextMenu, highlight }) {
  const [renaming, setRenaming] = useState(false);
  const bodyRef = useRef(null);

  // Markdown + KaTeX parsing is expensive — memoize by content so drags and
  // resizes (which re-render every frame) reuse the parsed tree instead of
  // re-parsing, which caused the whole-canvas jitter.
  const answerBody = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" />
          ),
        }}
      >
        {tile.text}
      </ReactMarkdown>
    ),
    [tile.text],
  );

  // Grow the tile to fit a fresh answer (capped); manual resizes after that
  // are respected until the next answer arrives.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      const extra = body.scrollHeight - body.clientHeight;
      if (extra > 4) {
        onChange(tile.id, { h: Math.min(tile.h + extra, 640) });
      }
    };
    fit();
    const t = setTimeout(fit, 400);
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => fit()).catch(() => {});
    }
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tile.text]);

  const commitName = (v) => {
    setRenaming(false);
    if (v !== null && v !== (tile.name || "")) onChange(tile.id, { name: v });
  };

  return (
    <Rnd
      size={{ width: tile.w, height: tile.h }}
      position={{ x: tile.x, y: tile.y }}
      scale={scale}
      minWidth={220}
      minHeight={140}
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
      onResize={(e, dir, ref, delta, pos) => {
        onTileResize(tile.id, ref.offsetWidth, ref.offsetHeight, pos.x, pos.y);
      }}
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
      style={{ zIndex: 40 }} // summaries float with text at the top
    >
      <div
        className={`tile flex h-full w-full flex-col overflow-hidden rounded-xl bg-gradient-to-br from-blue-100/70 via-white to-green-50 backdrop-blur-md transition-all duration-150 active:scale-[0.985] dark:from-blue-950/70 ${leaving ? "animate-tile-out" : "animate-tile-in"} dark:via-stone-900/70 dark:to-emerald-950/50 ${selected ? "shadow-[0_0_0_2px_rgba(59,130,246,0.8),0_8px_24px_rgba(59,130,246,0.35)] dark:shadow-[0_0_0_2px_rgba(250,160,22,0.8),0_8px_24px_rgba(250,160,22,0.35)]" : "shadow-[0_4px_20px_rgb(0,0,0,0.06)]"}`}
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
          className="tile-drag-handle group flex shrink-0 cursor-move items-center justify-between border-b border-blue-200/60 bg-[linear-gradient(to_right,rgba(59,130,246,0.14),rgba(34,197,94,0.08),rgba(250,204,21,0.10),rgba(239,68,68,0.12))] px-2 py-1 dark:border-white/10 dark:bg-[linear-gradient(to_right,rgba(96,165,250,0.18),rgba(74,222,128,0.10),rgba(253,224,71,0.10),rgba(248,113,113,0.14))]"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (e.target.closest?.("button, input, textarea")) return;
            setRenaming(true);
          }}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <GeminiIcon size={14} className="shrink-0" />
            {renaming ? (
              <TileName name={tile.name} placeholder="Gemini answer" onCommit={commitName} />
            ) : tile.name ? (
              <span className="max-w-[160px] truncate bg-[linear-gradient(to_right,#2563eb,#16a34a,#ca8a04,#dc2626)] bg-clip-text font-display text-[11px] font-medium text-transparent dark:bg-[linear-gradient(to_right,#93c5fd,#6ee7b7,#fde047,#fca5a5)]">
                {tile.name}
              </span>
            ) : (
              <NameHint />
            )}
          </span>
          <button
            aria-label="Delete summary"
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

        <div
          ref={bodyRef}
          className="md-body no-drag min-h-0 flex-1 overflow-y-auto p-3 text-[13px] leading-relaxed break-words text-stone-700 dark:text-stone-200"
        >
          {highlight ? (
            <div className="whitespace-pre-wrap">
              {highlightParts(tile.text, highlight)}
            </div>
          ) : (
            answerBody
          )}
        </div>
      </div>
    </Rnd>
  );
}
