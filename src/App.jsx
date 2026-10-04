import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TransformWrapper,
  TransformComponent,
  useTransformContext,
  useControls,
} from "react-zoom-pan-pinch";
import { Search, Type, X } from "lucide-react";
import TopPillHeader from "./components/TopPillHeader.jsx";
import TextNote from "./components/TextNote.jsx";
import MediaTile, { MEDIA_HEADER_H } from "./components/MediaTile.jsx";
import AudioTile from "./components/AudioTile.jsx";
import SummaryTile from "./components/SummaryTile.jsx";
import TileMenu from "./components/TileMenu.jsx";

const NOTE_W = 230;
const NOTE_H = 170;
const MEDIA_MAX = 360;
const AUDIO_W = 260;
const AUDIO_H = 132;
const SUM_W = 300;
const SUM_H = 220;
// Current model per Google (gemini-2.0-flash was retired); change here
// if the lineup moves again.
const GEMINI_MODEL = "gemini-3.8-flash";
// ElevenLabs read-aloud voice + current TTS model (legacy monolingual models
// may 422 — flip TTS_MODEL_ID back if needed).
const TTS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const TTS_MODEL_ID = "eleven_multilingual_v2";

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

// Shrink oversized stills before embedding so autosave stays under the
// ~5MB localStorage quota. GIF/SVG pass through untouched (animation/vector).
function processImageForStorage(dataUrl, file) {
  const t = (file.type || "").toLowerCase();
  const n = (file.name || "").toLowerCase();
  if (t === "image/gif" || /\.gif$/.test(n)) return Promise.resolve(dataUrl);
  if (t === "image/svg+xml" || /\.svg$/.test(n)) return Promise.resolve(dataUrl);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 1600;
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        if (!w || !h || Math.max(w, h) <= MAX) {
          resolve(dataUrl);
          return;
        }
        const s = MAX / Math.max(w, h);
        const c = document.createElement("canvas");
        c.width = Math.round(w * s);
        c.height = Math.round(h * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        // Keep alpha-capable formats lossless; photos go to JPEG.
        const outMime =
          t === "image/png" || t === "image/webp" ? t : "image/jpeg";
        resolve(c.toDataURL(outMime, 0.9));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function isQuotaError(err) {
  return (
    !!err &&
    (err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014)
  );
}

// Strip markdown/formatting residue so AI summaries render as one clean
// plain-text paragraph: headings, quotes, list markers, rules, bold,
// italics, and inline code are unwrapped, then everything joins up.
function cleanSummaryText(raw) {
  const lines = String(raw || "")
    .replace(/\r/g, "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .split("\n");
  const cleaned = [];
  for (let line of lines) {
    let l = line.trim();
    if (!l) continue;
    l = l.replace(/^#{1,6}\s+/, ""); // ### Heading → Heading
    l = l.replace(/^>\s?/, ""); // > quote → quote
    l = l.replace(/^([-*•]|\d+[.)])\s+/, ""); // - item / 1. item → item
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(l)) continue; // ---- rules
    l = l.replace(/(\*\*|__)(.*?)\1/g, "$2"); // **bold** → bold
    l = l.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?;:]|$)/g, "$1$2"); // *it* → it
    l = l.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?;:]|$)/g, "$1$2"); // _it_ → it
    l = l.replace(/`([^`\n]+)`/g, "$1"); // `code` → code
    l = l.replace(/[*_]{2,}/g, ""); // leftover doubles
    l = l.replace(/^[*_~>]+\s*/, ""); // leading markers
    l = l.replace(/#{1,}/g, ""); // stray hashes
    l = l.replace(/`/g, ""); // stray backticks
    l = l.trim();
    if (l) cleaned.push(l);
  }
  return cleaned.join(" ").replace(/\s{2,}/g, " ").trim();
}

// Extract a YouTube video ID from watch / share / shorts / live / embed URLs.
function parseYouTubeUrl(text) {
  const str = (text || "").trim();
  if (!str) return null;
  const m = str.match(
    /(?:youtube\.com\/(?:watch\?[^#\s]*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

// Extract a Gemini inline_data image part from an image tile, or null when
// the payload is missing, unsupported (GIF/SVG), or too large.
function tileImagePart(tile) {
  if (tile?.type !== "image" || typeof tile.src !== "string") return null;
  const m = tile.src.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/s);
  if (!m || m[3].length > 14000000) return null;
  let mime = m[1].toLowerCase();
  if (mime === "image/jpg") mime = "image/jpeg";
  return { inline_data: { mime_type: mime, data: m[3] } };
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
            t.type === "audio" ||
            t.type === "youtube" ||
            t.type === "summary"),
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
        transcript: typeof t.transcript === "string" ? t.transcript : "",
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
  controlsRef,
  onChange,
  onDelete,
  onDraggingTile,
  onTileMouseDown,
  onTileDragStart,
  onTileDrag,
  onTileDragStop,
  busyIds,
  onTileContextMenu,
  leavingIds,
}) {
  const ctx = useTransformContext();
  const controls = useControls();

  useEffect(() => {
    viewRef.current.wrapper = ctx.wrapperComponent;
    instanceRef.current = ctx;
    controlsRef.current = controls;
  }, [ctx, controls, viewRef, instanceRef, controlsRef]);

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
          busy: busyIds.includes(tile.id),
          leaving: leavingIds.includes(tile.id),
          onTileContextMenu,
        };
        if (tile.type === "text") {
          return <TextNote key={tile.id} {...common} />;
        }
        if (tile.type === "audio") {
          return <AudioTile key={tile.id} {...common} />;
        }
        if (tile.type === "summary") {
          return <SummaryTile key={tile.id} {...common} />;
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
  // Remembers the last quota warning so an oversized canvas warns once.
  const persistWarnRef = useRef(null);

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

  const nextId = useCallback((prefix) => {
    idRef.current += 1;
    return `${prefix}-${Date.now()}-${idRef.current}`;
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

  // ---- lightweight toast (empty-canvas nudge, API errors) ----
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg, ms = 3000) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  // ---- Gemini canvas summarizer ----
  const [summarizing, setSummarizing] = useState(false);

  const summarizeCanvas = useCallback(async () => {
    if (summarizing) return;
    const lines = [];
    const imageParts = [];
    for (const t of tilesRef.current) {
      if (t.type === "text") {
        const body = (t.text || "").trim();
        const label = (t.name || "").trim();
        if (body || label) {
          lines.push(`- Text note${label ? ` "${label}"` : ""}: ${body || "(empty)"}`);
        }
      } else if (t.type === "audio") {
        const tr = (t.transcript || "").trim();
        const label = (t.name || "Voice note").trim();
        if (tr) lines.push(`- Audio "${label}" transcript: ${tr}`);
        else lines.push(`- Audio clip titled "${label}" (not transcribed)`);
      } else if (t.type === "image") {
        const label = (t.name || "").trim();
        const part = tileImagePart(t);
        if (part && imageParts.length < 12) imageParts.push(part);
        if (label) lines.push(`- Image "${label}"`);
        else lines.push(`- An attached image (see image parts for visual content)`);
      } else if (t.type === "video") {
        const label = (t.name || "").trim();
        if (label) lines.push(`- Video: ${label}`);
      } else if (t.type === "youtube") {
        const label = (t.name || "").trim();
        const url = t.src
          ? `https://www.youtube.com/watch?v=${t.src}`
          : "(no link)";
        lines.push(`- YouTube video${label ? ` "${label}"` : ""}: ${url}`);
      } else if (t.type === "summary") {
        const body = (t.text || "").trim();
        if (body) lines.push(`- Previous summary: ${body}`);
      }
    }
    if (lines.length === 0) {
      showToast("Add some notes first to summarize!");
      return;
    }
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) {
      showToast("Missing VITE_GEMINI_API_KEY — restart dev server after adding .env", 4000);
      return;
    }
    setSummarizing(true);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: {
              parts: [
                {
                  text: "You are a spatial canvas AI assistant. Analyze all provided media—including text notes, audio transcriptions, image contents, and video references. Synthesize a structured executive summary highlighting connections across all visual and textual elements on the canvas. Respond in one plain-text paragraph with no markdown, headings, lists, bold, italics, quotes, code, or symbols such as #, *, >, -, _, or backticks — plain sentences only.",
                },
              ],
            },
            contents: [{ parts: [...imageParts, { text: lines.join("\n") }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
          }),
        },
      );
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          const msg = errJson?.error?.message;
          if (msg && typeof msg === "string") detail += ` — ${msg}`;
          console.error("Gemini summary error:", res.status, errJson);
        } catch {
          console.error("Gemini summary error:", res.status);
        }
        throw new Error(detail);
      }
      const json = await res.json();
      const summary = cleanSummaryText(
        ((json?.candidates?.[0]?.content?.parts || []))
          .map((p) => p?.text || "")
          .join(""),
      );
      if (!summary) {
        showToast("Gemini returned an empty summary");
        return;
      }
      const wrapper =
        viewRef.current.wrapper ?? instanceRef.current?.wrapperComponent;
      let cx = 0;
      let cy = 0;
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const p = clientToContent(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        cx = p.x;
        cy = p.y;
      }
      setTiles((prev) => [
        ...prev,
        {
          id: nextId("summary"),
          type: "summary",
          x: cx - SUM_W / 2,
          y: cy - SUM_H / 2,
          w: SUM_W,
          h: SUM_H,
          text: summary,
          name: "Gemini Synthesis",
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Summary failed (${msg || "network error"})`, 4000);
    } finally {
      setSummarizing(false);
    }
  }, [summarizing, showToast, clientToContent, nextId]);

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
        if (kind === "image") {
          url = await processImageForStorage(url, file);
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

  const addYouTubeTile = useCallback(
    (videoId, pageUrl, baseX, baseY) => {
      const shorts = /\/shorts\//.test(pageUrl || "");
      const mediaW = shorts ? 240 : 360;
      const mediaH = Math.round(mediaW * (shorts ? 16 / 9 : 9 / 16));
      const w = mediaW;
      const h = mediaH + MEDIA_HEADER_H;
      setTiles((prev) => [
        ...prev,
        {
          id: nextId("youtube"),
          type: "youtube",
          x: baseX - w / 2,
          y: baseY - h / 2,
          w,
          h,
          ratio: shorts ? 9 / 16 : 16 / 9,
          src: videoId,
          name: "YouTube video",
        },
      ]);
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

  // Clicking empty canvas or another tile ends text editing — but never
  // steals the caret when clicking inside the field being edited. Wired as
  // a capture handler so inner stopPropagation calls can't block it.
  const blurActiveText = useCallback((e) => {
    const a = document.activeElement;
    if (
      a instanceof HTMLElement &&
      (a.tagName === "TEXTAREA" ||
        (a.tagName === "INPUT" && a.type === "text"))
    ) {
      if (e.target instanceof Node && (a === e.target || a.contains(e.target)))
        return;
      a.blur();
    }
  }, []);

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
      const p = clientToContent(e.clientX, e.clientY);
      if (files.length > 0) {
        void addMediaTiles(files, p.x, p.y);
        return;
      }
      // Link drops (e.g. dragged from the address bar) carry URL text.
      const raw =
        e.dataTransfer?.getData("text/uri-list") ||
        e.dataTransfer?.getData("text/plain") ||
        "";
      const first = raw
        .split(/[\r\n]+/)
        .map((s) => s.trim())
        .find(Boolean);
      if (!first) return;
      const ytId = parseYouTubeUrl(first);
      if (ytId) {
        addYouTubeTile(ytId, first, p.x, p.y);
      } else if (/^https?:\/\//i.test(first)) {
        showToast("Only YouTube links can be embedded for now", 2500);
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [addMediaTiles, addYouTubeTile, clientToContent, showToast]);

  // Tiles fade/shrink out instead of vanishing: mark them leaving, then
  // remove after the exit animation. Pending removals accumulate in a ref
  // so rapid successive deletes never strand a tile.
  const [leavingIds, setLeavingIds] = useState([]);
  const leaveTimer = useRef(null);
  const pendingRemoveRef = useRef(new Set());

  const removeTiles = useCallback((ids) => {
    const list = [...new Set(ids)];
    if (list.length === 0) return;
    for (const id of list) pendingRemoveRef.current.add(id);
    const kept = selectedRef.current.filter(
      (x) => !pendingRemoveRef.current.has(x),
    );
    selectedRef.current = kept;
    setSelectedIds(kept);
    setLeavingIds((prev) => [
      ...prev,
      ...list.filter((id) => !prev.includes(id)),
    ]);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      const doomed = new Set(pendingRemoveRef.current);
      pendingRemoveRef.current.clear();
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
      setLeavingIds((prev) => prev.filter((x) => !doomed.has(x)));
    }, 190);
  }, []);

  const deleteTile = useCallback(
    (id) => {
      removeTiles([id]);
    },
    [removeTiles],
  );

  const deleteSelected = useCallback(() => {
    removeTiles(selectedRef.current);
  }, [removeTiles]);

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

  // Delete key removes all selected tiles (never while typing).
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
      if (e.key !== "Delete") return;
      if (isEditableTarget(e)) return;
      if (selectedRef.current.length === 0) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected]);

  // ---- single read-aloud preview (one at a time, driven from tile menus) ----
  const [previewingId, setPreviewingId] = useState(null);
  const previewIdRef = useRef(null);
  const previewAudioRef = useRef(null);
  const previewUrlRef = useRef(null);

  const stopPreview = useCallback(() => {
    try {
      previewAudioRef.current?.pause();
    } catch {
      /* noop */
    }
    previewAudioRef.current = null;
    if (previewUrlRef.current) {
      try {
        URL.revokeObjectURL(previewUrlRef.current);
      } catch {
        /* noop */
      }
      previewUrlRef.current = null;
    }
    previewIdRef.current = null;
    setPreviewingId(null);
  }, []);

  const speakTile = useCallback(
    async (tile) => {
      if (previewIdRef.current === tile.id) {
        stopPreview();
        return;
      }
      const text = (tile.text || "").trim();
      if (!text) return;
      const key = import.meta.env.VITE_ELEVENLABS_API_KEY;
      if (!key) {
        showToast(
          "Missing VITE_ELEVENLABS_API_KEY — restart dev server after adding .env",
          4000,
        );
        return;
      }
      stopPreview();
      previewIdRef.current = tile.id;
      setPreviewingId(tile.id);
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
          throw new Error(detail);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        const audio = new Audio(url);
        previewAudioRef.current = audio;
        audio.onended = () => stopPreview();
        audio.onerror = () => {
          showToast("Read aloud failed (playback error)", 4000);
          stopPreview();
        };
        await audio.play();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Read aloud failed (${msg || "network error"})`, 4000);
        stopPreview();
      }
    },
    [stopPreview, showToast],
  );

  // ---- per-tile busy set (transcriptions in flight) ----
  const [busyIds, setBusyIds] = useState([]);

  // Stop voice previews for tiles that no longer exist.
  useEffect(() => {
    if (
      previewIdRef.current &&
      !tiles.some((t) => t.id === previewIdRef.current)
    ) {
      stopPreview();
    }
  }, [tiles, stopPreview]);

  const transcribeTile = useCallback(
    async (tile) => {
      if (!tile?.src || busyIds.includes(tile.id)) return;
      const key = import.meta.env.VITE_ELEVENLABS_API_KEY;
      if (!key) {
        showToast(
          "Missing VITE_ELEVENLABS_API_KEY — restart dev server after adding .env",
          4000,
        );
        return;
      }
      setBusyIds((prev) => [...prev, tile.id]);
      showToast("Transcribing audio…", 20000);
      try {
        const blob = await (await fetch(tile.src)).blob();
        const ext = blob.type.includes("mp4")
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
        updateTile(tile.id, {
          transcript: text,
          h: Math.max(tile.h || 0, 200),
        });
        showToast("Transcript ready");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Transcription failed (${msg || "network error"})`, 5000);
      } finally {
        setBusyIds((prev) => prev.filter((x) => x !== tile.id));
      }
    },
    [busyIds, showToast, updateTile],
  );

  const downloadTile = useCallback(
    (tile) => {
      if (!tile?.src) {
        showToast("Nothing to download — file not saved on this device");
        return;
      }
      let ext = "bin";
      const mm = tile.src.match(/^data:(\w+)\/([\w.+-]+);/);
      if (mm) {
        const sub = mm[2].toLowerCase();
        ext =
          sub === "mpeg"
            ? "mp3"
            : sub === "mp4" && tile.type === "audio"
              ? "m4a"
              : sub;
      } else if (tile.name && /\.\w{2,4}$/.test(tile.name)) {
        ext = tile.name.split(".").pop().toLowerCase();
      }
      const base =
        (tile.name || "recording").replace(/\.\w{2,4}$/, "") || "recording";
      const a = document.createElement("a");
      a.href = tile.src;
      a.download = `${base}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    [showToast],
  );

  const explainImage = useCallback(
    async (tile) => {
      if (tile?.type !== "image" || busyIds.includes(tile.id)) return;
      const key = import.meta.env.VITE_GEMINI_API_KEY;
      if (!key) {
        showToast(
          "Missing VITE_GEMINI_API_KEY — restart dev server after adding .env",
          4000,
        );
        return;
      }
      const part = tileImagePart(tile);
      if (!part) {
        showToast("Couldn't read this image for analysis");
        return;
      }
      setBusyIds((prev) => [...prev, tile.id]);
      showToast("Analyzing image…", 30000);
      try {
        const label = (tile.name || "").trim();
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: {
                parts: [
                  {
                    text: "You are a helpful visual assistant. Explain what is shown in the provided image in one plain-text paragraph. If it contains a math problem, homework question, or puzzle, solve it step by step in plain sentences and end with the final answer. No markdown, headings, lists, or symbols.",
                  },
                ],
              },
              contents: [
                {
                  parts: [
                    part,
                    {
                      text: `Tile titled "${label || "untitled image"}". Explain it${label ? "" : " in detail"}.`,
                    },
                  ],
                },
              ],
              generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
            }),
          },
        );
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const errJson = await res.json();
            const msg = errJson?.error?.message;
            if (msg && typeof msg === "string") detail += ` — ${msg}`;
            console.error("Gemini explain error:", res.status, errJson);
          } catch {
            console.error("Gemini explain error:", res.status);
          }
          throw new Error(detail);
        }
        const json = await res.json();
        const solution = cleanSummaryText(
          ((json?.candidates?.[0]?.content?.parts || []))
            .map((p) => p?.text || "")
            .join(""),
        );
        if (!solution) {
          showToast("Gemini returned an empty explanation");
          return;
        }
        setTiles((prev) => [
          ...prev,
          {
            id: nextId("summary"),
            type: "summary",
            x: tile.x + tile.w + 24,
            y: tile.y,
            w: SUM_W,
            h: SUM_H,
            text: solution,
            name: "Explanation",
          },
        ]);
        showToast("Explanation ready");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Explanation failed (${msg || "network error"})`, 4000);
      } finally {
        setBusyIds((prev) => prev.filter((x) => x !== tile.id));
      }
    },
    [busyIds, showToast, nextId],
  );

  // ---- right-click tile menu (text/audio/image only) ----
  const [menu, setMenu] = useState(null); // { x, y, id } in client coords; id null = background
  const [menuShown, setMenuShown] = useState(false);
  const menuTimer = useRef(null);

  const openMenu = useCallback((m) => {
    if (menuTimer.current) {
      clearTimeout(menuTimer.current);
      menuTimer.current = null;
    }
    setMenu(m);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setMenuShown(true));
    });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuShown(false);
    if (menuTimer.current) clearTimeout(menuTimer.current);
    menuTimer.current = setTimeout(() => setMenu(null), 150);
  }, []);

  const handleTileContextMenu = useCallback((id, x, y) => {
    const t = tilesRef.current.find((t) => t.id === id);
    if (!t || (t.type !== "text" && t.type !== "audio" && t.type !== "image"))
      return;
    openMenu({ x, y, id });
  }, [openMenu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e) => {
      if (!e.target.closest?.(".tile-menu")) closeMenu();
    };
    const onKey = (e) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, closeMenu]);

  useEffect(
    () => () => {
      if (menuTimer.current) clearTimeout(menuTimer.current);
    },
    [],
  );

  // Persist every tiles update (debounced) so notes survive refreshes.
  // Media embeds can exceed the ~5MB localStorage quota — in that case drop
  // the heaviest payloads first so text, names, and layout always survive.
  useEffect(() => {
    const t = setTimeout(() => {
      const save = (list) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      };
      try {
        save(tiles);
        persistWarnRef.current = null;
        return;
      } catch (err) {
        if (!isQuotaError(err)) {
          console.warn("Could not persist canvas tiles:", err);
          return;
        }
      }
      const slim = tiles.map((x) => ({ ...x }));
      const withSrc = slim
        .filter((x) => typeof x.src === "string" && x.src.length > 0)
        .sort((a, b) => b.src.length - a.src.length);
      const dropped = [];
      let saved = withSrc.length === 0;
      for (const cand of withSrc) {
        delete cand.src;
        dropped.push(cand.id);
        try {
          save(slim);
          saved = true;
          break;
        } catch {
          continue;
        }
      }
      const key = saved ? dropped.join(",") : "failed";
      if (persistWarnRef.current === key) return;
      persistWarnRef.current = key;
      if (!saved) {
        console.warn(
          "Canvas too large to persist — even notes could not be saved.",
        );
      } else {
        console.warn(
          `Canvas exceeded storage quota — ${dropped.length} media file(s) excluded from autosave; notes and layout preserved.`,
        );
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

  // Living ASCII wave background: a fixed full-viewport canvas of wave glyphs
  // that slides with pan and morphs/brightens around the cursor.
  const waveRef = useRef(null);

  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const d = dpr();
      canvas.width = Math.max(1, Math.floor(window.innerWidth * d));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * d));
    };
    resize();
    window.addEventListener("resize", resize);
    const CHARS = ["·", "~", "≈", "∿", "≋"];
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 66) return; // ~15fps stepped ascii motion
      last = now;
      const d = dpr();
      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      const dark = document.documentElement.classList.contains("dark");
      // Screen-fixed checkered grid: it never translates with pan or zoom,
      // so canvas motion can't feel dizzying. Only the wave phase and the
      // cursor aura move.
      const gap = 24 * d;
      ctx.font = `${12 * d}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const t = now / 1400;
      const cur = cursorRef.current;
      const cols = Math.ceil(w / gap);
      const rows = Math.ceil(h / gap);
      for (let i = 0; i <= cols; i++) {
        for (let j = 0; j <= rows; j++) {
          const sx = i * gap;
          const sy = j * gap;
          const cxx = sx / d;
          const cyy = sy / d;
          let v = Math.sin(cxx * 0.05 + t) + Math.cos(cyy * 0.05 - t * 0.8);
          let glow = 0;
          if (cur) {
            const dx = sx / d - cur.x;
            const dy = sy / d - cur.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 240) {
              const b = 1 - dist / 240;
              v += b * 3;
              glow = b * b;
            }
          }
          let idx = Math.floor(((v + 2) / 5.5) * CHARS.length);
          if (idx < 0) idx = 0;
          else if (idx > CHARS.length - 1) idx = CHARS.length - 1;
          const a = dark
            ? 0.12 + idx * 0.03 + glow * 0.4
            : 0.4 + idx * 0.05 + glow * 0.45;
          ctx.globalAlpha = a > 1 ? 1 : a;
          ctx.fillStyle = dark ? "#ffffff" : "#a8a29e";
          ctx.fillText(CHARS[idx], sx, sy);
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
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

  // Cleanup recorder + voice preview on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      stopPreview();
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
  }, [stopTimer, stopPreview]);

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
      <canvas
        ref={waveRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <TopPillHeader onSummarize={summarizeCanvas} summarizing={summarizing} />

      {searchOpen && (
        <div className="absolute top-20 left-1/2 z-50 flex -translate-x-1/2 animate-fade-slide-in items-center gap-2 rounded-full border border-white/60 bg-white/80 py-1.5 pr-2 pl-3.5 shadow-lg ring-1 ring-black/5 backdrop-blur-xl dark:border-white/10 dark:bg-stone-900/85 dark:ring-white/10">
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
        onMouseDownCapture={blurActiveText}
        onContextMenu={(e) => {
          e.preventDefault();
          if (e.target.closest?.(".tile-rnd")) return;
          openMenu({ x: e.clientX, y: e.clientY, id: null });
        }}
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
              controlsRef={controlsRef}
              onChange={updateTile}
              onDelete={deleteTile}
              onDraggingTile={setIsDraggingTile}
              onTileMouseDown={handleTileMouseDown}
              onTileDragStart={handleTileDragStart}
              onTileDrag={handleTileDrag}
              onTileDragStop={handleTileDragStop}
              busyIds={busyIds}
              leavingIds={leavingIds}
              onTileContextMenu={handleTileContextMenu}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>

      {tiles.length === 0 && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-40 -translate-x-1/2 -translate-y-1/2 animate-fade-in">
          <div
            aria-hidden="true"
            className="welcome-glow absolute -inset-3 rounded-[28px]"
          />
          <div className="relative flex flex-col items-center gap-2 rounded-2xl border border-neutral-200/70 bg-white/60 px-6 py-4.5 text-center shadow-sm backdrop-blur-sm select-none dark:border-white/10 dark:bg-stone-900/60">
          <p className="font-display text-base font-medium text-neutral-600 dark:text-stone-200">Welcome to <span className="font-bold">Atless</span>.</p>
          <p className="max-w-[240px] text-sm leading-relaxed text-balance text-neutral-400 dark:text-stone-500">
            more productivity, <span className="font-bold">less clutter</span>.
          </p>
          <p className="text-sm text-neutral-400 dark:text-stone-500">
            double-click anywhere to begin.
          </p>
          </div>
        </div>
      )}

      {toast && (
        <div className="absolute bottom-20 left-1/2 z-50 max-w-[92vw] -translate-x-1/2 animate-fade-in rounded-full border border-neutral-200 bg-white/90 px-4 py-2 text-xs whitespace-nowrap text-stone-700 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-200">
          {toast}
        </div>
      )}

      {menu &&
        (() => {
          const t = tiles.find((x) => x.id === menu.id);
          if (!t) return null;
          return (
            <TileMenu
              x={menu.x}
              y={menu.y}
              tile={t}
              playing={previewingId === t.id}
              busy={busyIds.includes(t.id)}
              onSpeak={() => {
                closeMenu();
                speakTile(t);
              }}
              onTranscribe={() => {
                closeMenu();
                transcribeTile(t);
              }}
              onDownload={() => {
                closeMenu();
                downloadTile(t);
              }}
              onExplain={() => {
                closeMenu();
                explainImage(t);
              }}
              onDelete={() => {
                const id = t.id;
                closeMenu();
                // Deleting from a multi-selection removes the whole group.
                if (
                  selectedRef.current.includes(id) &&
                  selectedRef.current.length > 1
                ) {
                  deleteSelected();
                } else {
                  deleteTile(id);
                }
              }}
              shown={menuShown}
            />
          );
        })()}

      {menu && !menu.id && (
        <div
          role="menu"
          aria-label="Canvas actions"
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={`tile-menu fixed z-[60] w-52 rounded-2xl border border-white/60 bg-white/85 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur-xl transition-all duration-150 origin-top-left dark:border-white/10 dark:bg-stone-900/90 dark:ring-white/10 ${
            menuShown ? "scale-100 opacity-100" : "pointer-events-none scale-[0.97] opacity-0"
          }`}
          style={{
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 216)),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - 80)),
          }}
        >
          <button
            onClick={() => {
              const p = clientToContent(menu.x, menu.y);
              closeMenu();
              addTile(p.x, p.y);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-stone-700 transition outline-none hover:bg-neutral-100 dark:text-stone-200 dark:hover:bg-white/10"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-stone-400">
              <Type size={13} />
            </span>
            Create text tile
          </button>
        </div>
      )}

      {marqueeBox && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 border border-stone-400/70 bg-stone-500/10"
          style={{
            left: marqueeBox.l,
            top: marqueeBox.t,
            width: marqueeBox.w,
            height: marqueeBox.h,
          }}
        />
      )}

      {isRecording && (
        <div className="absolute bottom-6 left-1/2 z-50 flex max-w-[94vw] -translate-x-1/2 animate-fade-in items-center gap-2.5 overflow-hidden rounded-full border border-red-200/70 bg-white/90 py-2 pr-5 pl-3 whitespace-nowrap shadow-lg backdrop-blur-xl dark:border-red-500/30 dark:bg-stone-900/90">
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

    </div>
  );
}
