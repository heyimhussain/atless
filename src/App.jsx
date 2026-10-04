import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TransformWrapper,
  TransformComponent,
  useTransformContext,
  useTransformEffect,
  useControls,
} from "react-zoom-pan-pinch";
import { Search, X } from "lucide-react";
import TopPillHeader from "./components/TopPillHeader.jsx";
import TextNote from "./components/TextNote.jsx";
import MediaTile, { MEDIA_HEADER_H } from "./components/MediaTile.jsx";
import AudioTile from "./components/AudioTile.jsx";

const NOTE_W = 230;
const NOTE_H = 170;
const MEDIA_MAX = 360;
const AUDIO_W = 260;
const AUDIO_H = 132;

function fitBox(nw, nh, max = MEDIA_MAX) {
  if (!nw || !nh) return { w: 320, h: 240 };
  const s = Math.min(1, max / Math.max(nw, nh));
  return { w: Math.round(nw * s), h: Math.round(nh * s) };
}

function probeImageSize(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve(fitBox(img.naturalWidth, img.naturalHeight));
    img.onerror = () => resolve({ w: 300, h: 220 });
    img.src = url;
  });
}

function probeVideoSize(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () =>
      resolve(fitBox(v.videoWidth, v.videoHeight));
    v.onerror = () => resolve({ w: 360, h: 240 });
    v.src = url;
  });
}

function kindOf(file) {
  const t = (file.type || "").toLowerCase();
  const n = (file.name || "").toLowerCase();
  // MIME type first (authoritative), extension as fallback — this also
  // disambiguates containers like .ogg (audio/ogg vs video/ogg).
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(n)) return "image";
  if (/\.(mp4|webm|mov)$/.test(n)) return "video";
  if (/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/.test(n)) return "audio";
  return null;
}

function isEditableTarget(e) {
  const el = e.target;
  return Boolean(el?.closest?.("textarea, input, select, [contenteditable]"));
}

const STORAGE_KEY = "spatial-canvas-tiles-v1";

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function loadTiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t) =>
          t &&
          (t.type === "text" ||
            t.type === "image" ||
            t.type === "video" ||
            t.type === "audio"),
      )
      .map((t, i) => ({
        id: typeof t.id === "string" ? t.id : `restored-${Date.now()}-${i}`,
        type: t.type,
        x: Number.isFinite(+t.x) ? +t.x : (i % 5) * 40,
        y: Number.isFinite(+t.y) ? +t.y : (i % 5) * 40,
        w: Number.isFinite(+t.w) && +t.w > 0 ? +t.w : 260,
        // Audio tiles have a fixed height (vertical resize is disabled),
        // so normalize any legacy taller drops to the recording size.
        h:
          t.type === "audio"
            ? AUDIO_H
            : Number.isFinite(+t.h) && +t.h > 0
              ? +t.h
              : 160,
        text: typeof t.text === "string" ? t.text : "",
        src: typeof t.src === "string" ? t.src : undefined,
        // Legacy text notes were saved with name "text" — treat as unnamed.
        name:
          typeof t.name === "string" &&
          !(t.type === "text" && t.name === "text")
            ? t.name
            : "",
        ratio:
          Number.isFinite(+t.ratio) && +t.ratio > 0 ? +t.ratio : undefined,
      }));
  } catch {
    return [];
  }
}

/** Inner canvas surface — must live inside TransformWrapper to use its context. */
function CanvasSurface({
  tiles,
  scale,
  selectedIds,
  viewRef,
  instanceRef,
  gridRef,
  controlsRef,
  onChange,
  onDelete,
  onDraggingTile,
  onTileMouseDown,
  onTileDragStart,
  onTileDrag,
  onTileDragStop,
}) {
  const ctx = useTransformContext();
  const controls = useControls();

  useEffect(() => {
    viewRef.current.wrapper = ctx.wrapperComponent;
    instanceRef.current = ctx;
    controlsRef.current = controls;
  }, [ctx, controls, viewRef, instanceRef, controlsRef]);

  // Keep the infinite dot grid glued to the canvas: fixed-size dots that
  // slide 1:1 with pan, written straight to the DOM on every transform
  // (no React-state lag during smooth zoom/pan animations).
  const syncGrid = useCallback(
    (s) => {
      const el = gridRef.current;
      if (!el || !s) return;
      const x = s.positionX ?? 0;
      const y = s.positionY ?? 0;
      el.style.backgroundPosition = `${x}px ${y}px`;
    },
    [gridRef],
  );
  useTransformEffect(syncGrid);

  return (
    // Zero-size anchor: tiles are absolutely positioned, so the transform
    // layer stays tiny and pans at full framerate (no giant texture).
    <div className="relative h-0 w-0">

      {tiles.map((tile) => {
        const common = {
          tile,
          scale,
          selected: selectedIds.includes(tile.id),
          onChange,
          onDelete,
          onDraggingTile,
          onTileMouseDown,
          onTileDragStart,
          onTileDrag,
          onTileDragStop,
        };
        if (tile.type === "text") {
          return <TextNote key={tile.id} {...common} />;
        }
        if (tile.type === "audio") {
          return <AudioTile key={tile.id} {...common} />;
        }
        return <MediaTile key={tile.id} {...common} />;
      })}
    </div>
  );
}

export default function App() {
  const [tiles, setTiles] = useState(loadTiles);
  const [scale, setScale] = useState(1);
  const [isRecording, setIsRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [recError, setRecError] = useState(null);
  const idRef = useRef(0);
  const viewRef = useRef({ positionX: 0, positionY: 0, scale: 1, wrapper: null });
  // Live library instance — always current, never a stale mirror.
  const instanceRef = useRef(null);
  const gridRef = useRef(null);
  // Bound transform controls (setTransform, …) captured inside the canvas.
  const controlsRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const recordingRef = useRef(false);
  const startAtRef = useRef(0);
  const timerRef = useRef(null);
  const [isDraggingTile, setIsDraggingTile] = useState(false);
  // Last known cursor position (client coords) — audio lands here on stop.
  const cursorRef = useRef(null);

  // ---- tile selection (single click, ctrl-toggle, marquee box) ----
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedRef = useRef([]);
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  const marqueeRef = useRef(null);
  const [marqueeBox, setMarqueeBox] = useState(null);
  // Pan mode indicator — grab cursor only while Shift is held.
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  // Snapshot of group positions taken when a tile drag starts.
  const groupDragRef = useRef(null);

  const selectOnly = useCallback((id) => {
    selectedRef.current = [id];
    setSelectedIds([id]);
  }, []);

  const toggleSelect = useCallback((id) => {
    const next = selectedRef.current.includes(id)
      ? selectedRef.current.filter((x) => x !== id)
      : [...selectedRef.current, id];
    selectedRef.current = next;
    setSelectedIds(next);
  }, []);

  const clearSelection = useCallback(() => {
    if (selectedRef.current.length === 0) return;
    selectedRef.current = [];
    setSelectedIds([]);
  }, []);

  // ---- canvas search (Ctrl+F): matches tile titles + note text, pans to hits ----
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(-1);
  const searchInputRef = useRef(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return tiles.filter(
      (t) =>
        (t.name || "").toLowerCase().includes(q) ||
        (t.text || "").toLowerCase().includes(q),
    );
  }, [tiles, query]);

  const goToMatch = useCallback(
    (dir) => {
      if (matches.length === 0) return;
      const next =
        (((matchIdx + dir) % matches.length) + matches.length) %
        matches.length;
      const tile = matches[next];
      const setT = controlsRef.current?.setTransform;
      const inst = instanceRef.current;
      const wrapper = inst?.wrapperComponent;
      if (setT && inst && wrapper && inst.state) {
        const s = inst.state.scale;
        const rect = wrapper.getBoundingClientRect();
        const cx = tile.x + tile.w / 2;
        const cy = tile.y + tile.h / 2;
        try {
          void setT(
            rect.width / 2 - cx * s,
            rect.height / 2 - cy * s,
            s,
            350,
            "easeOut",
          );
        } catch {
          /* noop */
        }
      }
      setMatchIdx(next);
      selectOnly(tile.id);
    },
    [matches, matchIdx, selectOnly],
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setMatchIdx(-1);
  }, []);

  // Runs on tile mousedown (bubbles up from the drag handle — never blocked,
  // so Rnd still receives it). Ctrl/Cmd toggles, otherwise select exclusively.
  const handleTileMouseDown = useCallback(
    (id, e) => {
      if (e.target.closest?.(".no-drag")) return;
      if (e.ctrlKey || e.metaKey) toggleSelect(id);
      else if (!selectedRef.current.includes(id)) selectOnly(id);
    },
    [toggleSelect, selectOnly],
  );

  const nextId = useCallback((prefix) => {
    idRef.current += 1;
    return `${prefix}-${Date.now()}-${idRef.current}`;
  }, []);

  // Fires on every pan / zoom — keeps the tile drag scale and
  // viewport-center math in sync with the real transform.
  // (The dot grid itself syncs via a direct DOM subscription instead,
  // so it never lags behind smooth animations.)
  const handleTransform = useCallback((ref, state) => {
    const s = state ?? ref?.state;
    if (!s || typeof s.scale !== "number") return;
    // Guard float noise so pure pans don't re-render the whole tile tree.
    setScale((prev) => (Math.abs(prev - s.scale) > 1e-9 ? s.scale : prev));
    viewRef.current.positionX = s.positionX ?? 0;
    viewRef.current.positionY = s.positionY ?? 0;
    viewRef.current.scale = s.scale;
  }, []);

  const clientToContent = useCallback((clientX, clientY) => {
    // Read the live instance state so spawns are never computed from
    // a stale mirror of the transform.
    const inst = instanceRef.current;
    const state = inst?.state;
    const wrapper = inst?.wrapperComponent ?? viewRef.current.wrapper;
    const v = viewRef.current;
    if (!state || !wrapper || !state.scale) {
      if (!wrapper || !v.scale) return { x: clientX, y: clientY };
      const rect = wrapper.getBoundingClientRect();
      return {
        x: (clientX - rect.left - v.positionX) / v.scale,
        y: (clientY - rect.top - v.positionY) / v.scale,
      };
    }
    const rect = wrapper.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.positionX) / state.scale,
      y: (clientY - rect.top - state.positionY) / state.scale,
    };
  }, []);

  const viewportCenterContent = useCallback(() => {
    const wrapper =
      viewRef.current.wrapper ?? instanceRef.current?.wrapperComponent;
    if (!wrapper) return { x: 0, y: 0 };
    const rect = wrapper.getBoundingClientRect();
    return clientToContent(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
  }, [clientToContent]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const addTile = useCallback(
    (x, y) => {
      setTiles((prev) => [
        ...prev,
        {
          id: nextId("note"),
          type: "text",
          x,
          y,
          w: NOTE_W,
          h: NOTE_H,
          text: "",
          name: "",
        },
      ]);
    },
    [nextId],
  );

  // Double-click empty canvas → text note at the exact cursor point.
  // Tile interactions stop propagation / carry .tile-rnd, so only
  // background clicks land here. Lives on the fullscreen wrapper so
  // notes can be created anywhere in view.
  const handleEmptyDoubleClick = useCallback(
    (e) => {
      if (e.target.closest?.(".tile-rnd")) return;
      const p = clientToContent(e.clientX, e.clientY);
      addTile(p.x, p.y);
    },
    [clientToContent, addTile],
  );

  const addMediaTiles = useCallback(
    async (files, baseX, baseY) => {
      let i = 0;
      for (const file of files) {
        const kind = kindOf(file);
        if (!kind) continue;
        // Read as a data URL so the tile survives a browser refresh.
        let url;
        try {
          url = await fileToDataURL(file);
        } catch {
          continue;
        }
        let w;
        let h;
        let ratio;
        if (kind === "image") {
          ({ w, h } = await probeImageSize(url));
          ratio = w / h;
          // Box height includes the fixed drag-handle bar so the media
          // area below it matches the probed ratio exactly.
          h = h + MEDIA_HEADER_H;
        } else if (kind === "video") {
          ({ w, h } = await probeVideoSize(url));
          ratio = w / h;
          h = h + MEDIA_HEADER_H;
        } else {
          // Audio drops use the exact same tile size as recordings.
          w = AUDIO_W;
          h = AUDIO_H;
          ratio = AUDIO_W / AUDIO_H;
        }
        const x = baseX - w / 2 + i * 28;
        const y = baseY - h / 2 + i * 28;
        i += 1;
        setTiles((prev) => [
          ...prev,
          {
            id: nextId(kind),
            type: kind,
            x,
            y,
            w,
            h,
            // True media ratio — drives the resize lock (self-heals any drift).
            ratio,
            src: url,
            name: file.name,
          },
        ]);
      }
    },
    [nextId],
  );

  const updateTile = useCallback((id, patch) => {
    setTiles((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // Dragging one tile of a multi-selection carries the whole group along.
  // The dragged tile moves via Rnd internals; the rest follow live here.
  const handleTileDragStart = useCallback((id) => {
    setIsDraggingTile(true);
    const ids = selectedRef.current.includes(id)
      ? [...selectedRef.current]
      : [id];
    const atStart = {};
    for (const t of tilesRef.current) {
      if (ids.includes(t.id)) atStart[t.id] = { x: t.x, y: t.y };
    }
    groupDragRef.current = { id, ids, atStart };
  }, []);

  const handleTileDrag = useCallback((id, e, d) => {
    const snap = groupDragRef.current;
    if (!snap || snap.id !== id || !snap.atStart[id] || !d) return;
    const dx = d.x - snap.atStart[id].x;
    const dy = d.y - snap.atStart[id].y;
    if (dx === 0 && dy === 0) return;
    setTiles((prev) =>
      prev.map((t) =>
        t.id !== id && snap.ids.includes(t.id)
          ? { ...t, x: snap.atStart[t.id].x + dx, y: snap.atStart[t.id].y + dy }
          : t,
      ),
    );
  }, []);

  const handleTileDragStop = useCallback(
    (id, e, d) => {
      setIsDraggingTile(false);
      groupDragRef.current = null;
      e.stopPropagation?.();
      updateTile(id, { x: d.x, y: d.y });
    },
    [updateTile],
  );

  // Marquee: plain background press-and-drag (Shift is reserved for panning).
  const handleWrapperMouseDown = useCallback((e) => {
    if (e.button !== 0 || e.shiftKey) return;
    if (e.target.closest?.(".tile-rnd")) return;
    if (isEditableTarget(e)) return;
    e.preventDefault();
    marqueeRef.current = {
      x1: e.clientX,
      y1: e.clientY,
      ctrl: e.ctrlKey || e.metaKey,
      moved: false,
    };
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      const m = marqueeRef.current;
      if (!m) return;
      const dx = e.clientX - m.x1;
      const dy = e.clientY - m.y1;
      if (!m.moved && Math.hypot(dx, dy) < 4) return;
      m.moved = true;
      m.x2 = e.clientX;
      m.y2 = e.clientY;
      document.body.style.userSelect = "none";
      setMarqueeBox({
        l: Math.min(m.x1, e.clientX),
        t: Math.min(m.y1, e.clientY),
        w: Math.abs(dx),
        h: Math.abs(dy),
      });
    };
    const onUp = (e) => {
      const m = marqueeRef.current;
      if (!m) return;
      marqueeRef.current = null;
      document.body.style.userSelect = "";
      setMarqueeBox(null);
      if (!m.moved) {
        if (!m.ctrl) clearSelection(); // plain click on empty canvas
        return;
      }
      const a = clientToContent(m.x1, m.y1);
      const b = clientToContent(m.x2 ?? e.clientX, m.y2 ?? e.clientY);
      const rx1 = Math.min(a.x, b.x);
      const ry1 = Math.min(a.y, b.y);
      const rx2 = Math.max(a.x, b.x);
      const ry2 = Math.max(a.y, b.y);
      const hit = tilesRef.current
        .filter(
          (t) => t.x < rx2 && t.x + t.w > rx1 && t.y < ry2 && t.y + t.h > ry1,
        )
        .map((t) => t.id);
      const next = m.ctrl
        ? Array.from(new Set([...selectedRef.current, ...hit]))
        : hit;
      selectedRef.current = next;
      setSelectedIds(next);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [clientToContent, clearSelection]);

  // File drops work anywhere in the window — no bounded drop zone,
  // no highlight overlay. preventDefault also stops the browser
  // from navigating away when a file misses the canvas.
  useEffect(() => {
    const onDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []).filter(Boolean);
      if (files.length === 0) return;
      const p = clientToContent(e.clientX, e.clientY);
      void addMediaTiles(files, p.x, p.y);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [addMediaTiles, clientToContent]);

  const deleteTile = useCallback((id) => {
    if (selectedRef.current.includes(id)) {
      const next = selectedRef.current.filter((x) => x !== id);
      selectedRef.current = next;
      setSelectedIds(next);
    }
    setTiles((prev) => {
      const target = prev.find((t) => t.id === id);
      if (target?.src?.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(target.src);
        } catch {
          /* noop */
        }
      }
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const deleteSelected = useCallback(() => {
    const ids = selectedRef.current;
    if (ids.length === 0) return;
    const doomed = new Set(ids);
    selectedRef.current = [];
    setSelectedIds([]);
    setTiles((prev) => {
      for (const t of prev) {
        if (doomed.has(t.id) && t.src?.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(t.src);
          } catch {
            /* noop */
          }
        }
      }
      return prev.filter((t) => !doomed.has(t.id));
    });
  }, []);

  // Track Shift so the grab cursor only shows in pan mode.
  useEffect(() => {
    const onDown = (e) => {
      if (e.key === "Shift") setIsShiftPressed(true);
    };
    const onUp = (e) => {
      if (e.key === "Shift") setIsShiftPressed(false);
    };
    const onBlur = () => setIsShiftPressed(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Ctrl/Cmd + F opens canvas search (native find kept while typing).
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        if (isEditableTarget(e)) return;
        e.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [searchOpen]);

  // Delete / Backspace removes all selected tiles (never while typing).
  // Ctrl/Cmd + A selects every tile on the canvas.
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        if (isEditableTarget(e)) return;
        e.preventDefault();
        const all = tilesRef.current.map((t) => t.id);
        selectedRef.current = all;
        setSelectedIds(all);
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (isEditableTarget(e)) return;
      if (selectedRef.current.length === 0) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected]);

  // Persist every tiles update (debounced) so notes survive refreshes.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tiles));
      } catch (err) {
        console.warn("Could not persist canvas tiles:", err);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [tiles]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    stopTimer();
    if (!recordingRef.current || !rec || rec.state === "inactive") {
      recordingRef.current = false;
      setIsRecording(false);
      return;
    }
    // onstop spawns the audio tile; flip flags now so rapid toggles stay sane
    recordingRef.current = false;
    setIsRecording(false);
    try {
      rec.stop();
    } catch {
      /* noop */
    }
  }, [stopTimer]);

  const startRecording = useCallback(async () => {
    if (recordingRef.current) return;
    setRecError(null);
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecError("Microphone recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = rec;

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const chunks = chunksRef.current;
        chunksRef.current = [];
        const tracks = streamRef.current?.getTracks?.() ?? [];
        tracks.forEach((t) => {
          try {
            t.stop();
          } catch {
            /* noop */
          }
        });
        streamRef.current = null;
        recorderRef.current = null;
        if (chunks.length === 0) return;
        const blob = new Blob(chunks, {
          type: rec.mimeType || "audio/webm",
        });
        // Data URL (not a blob: URL) so the recording persists across refreshes.
        let url;
        try {
          url = await fileToDataURL(blob);
        } catch {
          return;
        }
        // Drop with the tile's top-left corner exactly on the cursor
        // (viewport center as fallback).
        const c = cursorRef.current;
        const p = c ? clientToContent(c.x, c.y) : viewportCenterContent();
        const count = idRef.current + 1;
        setTiles((prev) => [
          ...prev,
          {
            id: nextId("audio"),
            type: "audio",
            x: p.x,
            y: p.y,
            w: AUDIO_W,
            h: AUDIO_H,
            src: url,
            name: `Voice note ${count}`,
          },
        ]);
      };

      rec.start();
      recordingRef.current = true;
      startAtRef.current = Date.now();
      setRecSecs(0);
      setIsRecording(true);
      timerRef.current = setInterval(() => {
        setRecSecs((Date.now() - startAtRef.current) / 1000);
      }, 250);
    } catch (err) {
      recordingRef.current = false;
      setIsRecording(false);
      setRecError(
        err?.name === "NotAllowedError"
          ? "Microphone access denied — allow it to record."
          : "Could not start recording.",
      );
    }
  }, [nextId, stopTimer, clientToContent, viewportCenterContent]);

  // Track the cursor so recordings can land where the pointer is.
  useEffect(() => {
    const onMove = (e) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // Global Space (hold) / R (toggle) shortcuts
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e)) return;
      if (e.code === "Space") {
        e.preventDefault();
        void startRecording();
      } else if (e.key === "r" || e.key === "R") {
        if (recordingRef.current) stopRecording();
        else void startRecording();
      }
    };
    const onKeyUp = (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        stopRecording();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [startRecording, stopRecording]);

  // Cleanup recorder on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      try {
        recorderRef.current?.state !== "inactive" &&
          recorderRef.current?.stop?.();
      } catch {
        /* noop */
      }
      streamRef.current?.getTracks?.().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* noop */
        }
      });
    };
  }, [stopTimer]);

  // Auto-clear recording errors
  useEffect(() => {
    if (!recError) return;
    const t = setTimeout(() => setRecError(null), 4000);
    return () => clearTimeout(t);
  }, [recError]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#fafaf7] dark:bg-[#0c0a09]">
      {/* Infinite dot grid — fixed-size dots that slide 1:1 with pan,
          repainted in lockstep via a transform subscription (no lag). */}
      <div
        ref={gridRef}
        aria-hidden="true"
        className="dot-grid-layer pointer-events-none absolute inset-0"
      />
      <TopPillHeader />

      {searchOpen && (
        <div className="absolute top-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/60 bg-white/80 py-1.5 pr-2 pl-3.5 shadow-lg ring-1 ring-black/5 backdrop-blur-xl dark:border-white/10 dark:bg-stone-900/85 dark:ring-white/10">
          <Search size={14} className="shrink-0 text-neutral-400 dark:text-stone-500" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMatchIdx(-1);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                goToMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                closeSearch();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                goToMatch(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                goToMatch(-1);
              }
            }}
            placeholder="Search titles and notes…"
            spellCheck={false}
            className="w-36 bg-transparent text-[13px] text-stone-800 outline-none placeholder:text-neutral-400 sm:w-52 dark:text-stone-100 dark:placeholder:text-stone-500"
          />
          <span className="shrink-0 text-[11px] tabular-nums whitespace-nowrap text-neutral-400 dark:text-stone-500">
            {query
              ? matches.length > 0
                ? `${matchIdx + 1} of ${matches.length}`
                : "No matches"
              : `${tiles.length} tiles`}
          </span>
          <button
            onClick={closeSearch}
            aria-label="Close search"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-neutral-400 outline-none transition hover:bg-neutral-200/70 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-white/10 dark:hover:text-stone-200"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div
        className="transform-wrapper-fill absolute inset-0"
        onDoubleClick={handleEmptyDoubleClick}
        onMouseDown={handleWrapperMouseDown}
      >
        <TransformWrapper
          initialScale={1}
          minScale={0.2}
          maxScale={4}
          centerOnInit={false}
          limitToBounds={false}
          wheel={{ step: 0.001 }}
          doubleClick={{ disabled: true }}
          // Shift-only panning
          panning={{
            velocityDisabled: false,
            allowLeftClickPan: true,
            allowMiddleClickPan: true,
            allowRightClickPan: true,
            activationKeys: ["Shift"],
            disabled: isDraggingTile,
          }}
          onTransform={handleTransform}
        >
          <TransformComponent
            wrapperClass={`!w-full !h-full ${isShiftPressed ? "cursor-grab active:cursor-grabbing" : "cursor-default"}`}
          >
            <CanvasSurface
              tiles={tiles}
              scale={scale}
              selectedIds={selectedIds}
              viewRef={viewRef}
              instanceRef={instanceRef}
              gridRef={gridRef}
              controlsRef={controlsRef}
              onChange={updateTile}
              onDelete={deleteTile}
              onDraggingTile={setIsDraggingTile}
              onTileMouseDown={handleTileMouseDown}
              onTileDragStart={handleTileDragStart}
              onTileDrag={handleTileDrag}
              onTileDragStop={handleTileDragStop}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>

      {tiles.length === 0 && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 rounded-2xl border border-neutral-200/70 bg-white/60 px-6 py-4.5 text-center shadow-sm backdrop-blur-sm select-none dark:border-white/10 dark:bg-stone-900/60">
          <p className="text-base font-medium text-neutral-600 dark:text-stone-200">Welcome to <span className="font-bold">Atless</span>.</p>
          <p className="max-w-[240px] text-sm leading-relaxed text-balance text-neutral-400 dark:text-stone-500">
            more productivity, <span className="font-bold">less clutter</span>.
          </p>
          <p className="text-sm text-neutral-400 dark:text-stone-500">
            double-click anywhere to begin.
          </p>
        </div>
      )}

      {marqueeBox && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 border border-stone-400/70 bg-stone-500/10 dark:border-sky-300/40 dark:bg-sky-300/10"
          style={{
            left: marqueeBox.l,
            top: marqueeBox.t,
            width: marqueeBox.w,
            height: marqueeBox.h,
          }}
        />
      )}

      {isRecording && (
        <div className="absolute bottom-6 left-1/2 z-50 flex max-w-[94vw] -translate-x-1/2 items-center gap-2.5 overflow-hidden rounded-full border border-red-200/70 bg-white/90 py-2 pr-5 pl-3 whitespace-nowrap shadow-lg backdrop-blur-xl dark:border-red-500/30 dark:bg-stone-900/90">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
          </span>
          <span className="text-xs font-medium text-neutral-700 tabular-nums dark:text-stone-200">
            Recording {recSecs.toFixed(0)}s
          </span>
          <span className="hidden min-w-0 truncate text-[11px] text-neutral-400 min-[420px]:inline dark:text-stone-500">
            release Space / press R to stop
          </span>
        </div>
      )}

      {recError && !isRecording && (
        <div className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-red-200 bg-white/90 px-4 py-2 text-xs text-red-600 shadow-lg backdrop-blur-xl dark:border-red-500/30 dark:bg-stone-900/90 dark:text-red-400">
          {recError}
        </div>
      )}

      <footer className="pointer-events-none absolute right-4 bottom-3 z-50 text-[11px] tracking-tight text-neutral-400 dark:text-stone-500">
        © 2026 – Built with React/JS
      </footer>
    </div>
  );
}
