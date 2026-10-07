import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TransformWrapper,
  TransformComponent,
  useTransformContext,
  useControls,
} from "react-zoom-pan-pinch";
import { Loader2, Search, Send, Trash2, Type, X } from "lucide-react";
import GeminiIcon from "./components/GeminiIcon.jsx";
import TopPillHeader from "./components/TopPillHeader.jsx";
import TextNote from "./components/TextNote.jsx";
import MediaTile, { MEDIA_HEADER_H } from "./components/MediaTile.jsx";
import AudioTile from "./components/AudioTile.jsx";
// Markdown + KaTeX renderer loads on demand so the first paint stays lean.
const SummaryTile = lazy(() => import("./components/SummaryTile.jsx"));
import TileMenu from "./components/TileMenu.jsx";
import { tileDisplayName } from "./lib/tileName.js";

const NOTE_W = 230;
const NOTE_H = 170;
const MEDIA_MAX = 360;
const AUDIO_W = 260;
const AUDIO_H = 132;
const SUM_W = 300;
const SUM_H = 220;
// Current model per Google (gemini-2.0-flash was retired); change here
// if the lineup moves again.
const GEMINI_MODEL = "gemini-3.5-flash";
// ElevenLabs read-aloud voice + current TTS model (legacy monolingual models
// may 422 — flip TTS_MODEL_ID back if needed).
const TTS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const TTS_MODEL_ID = "eleven_multilingual_v2";

// Estimate an audio tile's full height so transcripts fit without
// scrolling: header + player + one padded block per wrapped line.
// Slightly generous on purpose — clipping is worse than whitespace.
function transcriptTileHeight(text, width) {
  const cpl = Math.max(20, Math.floor(((width || AUDIO_W) - 38) / 4.8));
  const lines = Math.max(1, Math.ceil(String(text || "").length / cpl));
  return Math.ceil(30 + 104 + 14 + lines * 17);
}

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

// Extract a Gemini inline_data audio part from a voice tile (recordings and
// drops are small enough to send inline), or null when missing or too large.
function tileAudioPart(tile) {
  if (tile?.type !== "audio" || typeof tile.src !== "string") return null;
  const m = tile.src.match(/^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/si);
  if (!m || m[2].length > 12000000) return null;
  return { inline_data: { mime_type: m[1].toLowerCase(), data: m[2] } };
}

// Flatten tiles into Gemini context: one text line per tile plus inline
// image/audio parts (capped so requests stay sane).
function collectTileContext(list) {
  const lines = [];
  const parts = [];
  let images = 0;
  let audios = 0;
  for (const t of list) {
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
      const apart = tileAudioPart(t);
      if (apart && audios < 4) {
        parts.push(apart);
        audios += 1;
      }
    } else if (t.type === "image") {
      const label = (t.name || "").trim();
      const part = tileImagePart(t);
      if (part && images < 12) {
        parts.push(part);
        images += 1;
      }
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
      if (body) lines.push(`- Previous Gemini answer: ${body}`);
    }
  }
  return { lines, parts };
}

function extractGeminiText(json) {
  return ((json?.candidates?.[0]?.content?.parts || []))
    .map((p) => p?.text || "")
    .join("");
}

// Anchor a connection endpoint to the edge of rect r facing (tx, ty).
function edgeAnchor(r, tx, ty) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { x: r.x + r.w, y: cy } : { x: r.x, y: cy };
  }
  return dy >= 0 ? { x: cx, y: r.y + r.h } : { x: cx, y: r.y };
}

// Outward unit normal of the edge that point p (an edge midpoint) sits on.
function edgeNormal(r, p) {
  if (p.y === r.y) return { x: 0, y: -1 };
  if (p.y === r.y + r.h) return { x: 0, y: 1 };
  if (p.x === r.x) return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}

// Smooth cubic arrow between two tiles. Both control points sit on the edge
// normals, so the line always meets each tile perpendicularly — never sliding
// parallel along an edge — while the bow still flexes with the layout.
// Shared control points for a connection curve, so the SVG path and
// marquee hit-testing use the exact same geometry.
function connectionControls(a, b) {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const p0 = edgeAnchor(a, bcx, bcy);
  const p1 = edgeAnchor(b, acx, acy);
  const n0 = edgeNormal(a, p0);
  const n1 = edgeNormal(b, p1);
  const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const bend = Math.min(Math.max(dist * 0.35, 24), 160);
  return {
    p0,
    p1,
    c1: { x: p0.x + n0.x * bend, y: p0.y + n0.y * bend },
    // c2 stays OUTSIDE B (along its outward normal) so the final segment —
    // and the arrowhead — travel into the tile, not away from it.
    c2: { x: p1.x + n1.x * bend, y: p1.y + n1.y * bend },
  };
}

// Gap between opposite-direction curves (A→B and B→A render side by side).
const PAIR_GAP = 10;

// Lateral shift for one side of a bidirectional pair: each direction offsets
// to its own side of the centerline so the pair reads as two parallel lines.
// Unpaired connections get zero shift.
function connectionLateral(a, b, paired) {
  if (!paired) return { x: 0, y: 0 };
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const len = Math.hypot(dx, dy) || 1;
  const k = PAIR_GAP / 2;
  return { x: (-dy / len) * k, y: (dx / len) * k };
}

// Slide an edge anchor along its edge (never off it) so arrowheads stay
// glued to tiles. Lateral pair separation bends the controls instead, so the
// two mechanisms can never cancel each other out.
function slideAlongEdge(r, p, extra = 0) {
  if (p.x === r.x || p.x === r.x + r.w) return { x: p.x, y: p.y + extra };
  return { x: p.x + extra, y: p.y };
}

function connectionPointsShifted(a, b, shift, offA = 0, offB = 0) {
  const { p0, p1, c1, c2 } = connectionControls(a, b);
  return {
    p0: slideAlongEdge(a, p0, offA),
    p1: slideAlongEdge(b, p1, offB),
    c1: { x: c1.x + shift.x, y: c1.y + shift.y },
    c2: { x: c2.x + shift.x, y: c2.y + shift.y },
  };
}

function pointsToPath({ p0, p1, c1, c2 }) {
  return `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p1.x},${p1.y}`;
}

function connectionPathShifted(a, b, shift, offA = 0, offB = 0) {
  return pointsToPath(connectionPointsShifted(a, b, shift, offA, offB));
}

function edgeKey(r, p) {
  if (p.x === r.x) return "L";
  if (p.x === r.x + r.w) return "R";
  if (p.y === r.y) return "T";
  return "B";
}

// One shared precompute per render: lateral pair shifts (applied to curve
// controls) plus direction-grouped endpoint anchors (applied to edge points).
// Each tile edge holds at most two points — one shared by all outbound links,
// one shared by all inbound links, PAIR_GAP apart — so arrowheads never stack.
// The outbound side follows any paired member's bend so pairs stay parallel
// instead of S-bending. Returns
// { offsets: Map "connId→tileId" => px, laterals: Map connId => {x, y} }.
function computeConnGeometry(connections, tileById) {
  const pairKeys = new Set(connections.map((c) => `${c.from}→${c.to}`));
  const laterals = new Map();
  const live = [];
  for (const c of connections) {
    const a = tileById.get(c.from);
    const b = tileById.get(c.to);
    if (!a || !b) continue;
    laterals.set(c.id, connectionLateral(a, b, pairKeys.has(`${c.to}→${c.from}`)));
    live.push({ c, a, b });
  }
  const groups = new Map();
  for (const { c, a, b } of live) {
    const lat = laterals.get(c.id);
    const ends = [
      [a, edgeAnchor(a, b.x + b.w / 2, b.y + b.h / 2), "out"],
      [b, edgeAnchor(b, a.x + a.w / 2, a.y + a.h / 2), "in"],
    ];
    for (const [t, p, dir] of ends) {
      const edge = edgeKey(t, p);
      const key = `${t.id}|${edge}|${dir}`;
      if (!groups.has(key))
        groups.set(key, {
          tile: t,
          vertical: edge === "L" || edge === "R",
          members: [],
        });
      const g = groups.get(key);
      g.members.push({
        key: `${c.id}→${t.id}`,
        // Lateral projection onto this edge's tangent (0 when unpaired),
        // in outbound frame so pair members always agree.
        proj: (edge === "L" || edge === "R" ? lat.y : lat.x) * (dir === "out" ? 1 : -1),
      });
    }
  }
  const edges = new Map();
  for (const [key, g] of groups) {
    const cut = key.lastIndexOf("|");
    const base = key.slice(0, cut);
    const dir = key.slice(cut + 1);
    if (!edges.has(base)) edges.set(base, {});
    edges.get(base)[dir] = g;
  }
  const offsets = new Map();
  for (const sides of edges.values()) {
    const out = sides.out;
    const inn = sides.in;
    if (out && inn) {
      // Reference side from any paired member; default keeps out at +.
      let ref = 0;
      for (const m of out.members) {
        if (m.proj !== 0) {
          ref = m.proj;
          break;
        }
      }
      if (ref === 0) {
        for (const m of inn.members) {
          if (m.proj !== 0) {
            ref = m.proj;
            break;
          }
        }
      }
      const side = ref >= 0 ? 1 : -1;
      const t = out.tile;
      const len = out.vertical ? t.h : t.w;
      const half = (PAIR_GAP / 2) * Math.min(1, Math.max(0, len - 8) / PAIR_GAP);
      for (const m of out.members) offsets.set(m.key, side * half);
      for (const m of inn.members) offsets.set(m.key, -side * half);
    } else {
      const g = out || inn;
      for (const m of g.members) offsets.set(m.key, 0);
    }
  }
  return { offsets, laterals };
}

function connectionPath(a, b) {
  return connectionPathShifted(a, b, { x: 0, y: 0 });
}

// Does a connection's curve pass through rect r? Samples the cubic so a
// marquee boxing just the line (no endpoints) still selects it. Takes the
// same lateral shift the renderer uses so paired lines test true geometry.
function connectionHitsRect(a, b, r, shift, offA = 0, offB = 0) {
  const s = shift || { x: 0, y: 0 };
  const { p0, p1, c1, c2 } = connectionControls(a, b);
  const q0 = slideAlongEdge(a, p0, offA);
  const q1 = slideAlongEdge(b, p1, offB);
  const k1 = { x: c1.x + s.x, y: c1.y + s.y };
  const k2 = { x: c2.x + s.x, y: c2.y + s.y };
  const N = 32;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x =
      u * u * u * q0.x + 3 * u * u * t * k1.x + 3 * u * t * t * k2.x + t * t * t * q1.x;
    const y =
      u * u * u * q0.y + 3 * u * u * t * k1.y + 3 * u * t * t * k2.y + t * t * t * q1.y;
    if (x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2) return true;
  }
  return false;
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
const CONN_KEY = "atless-connections-v1";

function loadConnections(tiles) {
  try {
    const raw = localStorage.getItem(CONN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = new Set(tiles.map((t) => t.id));
    const seen = new Set();
    return parsed
      .filter((c) => {
        if (
          !c ||
          typeof c.from !== "string" ||
          typeof c.to !== "string" ||
          c.from === c.to
        )
          return false;
        if (!ids.has(c.from) || !ids.has(c.to)) return false;
        const k = `${c.from}→${c.to}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((c) => ({
        id:
          typeof c.id === "string" ? c.id : `conn-${c.from}-${c.to}`,
        from: c.from,
        to: c.to,
      }));
  } catch {
    return [];
  }
}

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
      .map((t, i) => {
        const w = Number.isFinite(+t.w) && +t.w > 0 ? +t.w : 260;
        const transcript =
          typeof t.transcript === "string" ? t.transcript : "";
        return {
          id: typeof t.id === "string" ? t.id : `restored-${Date.now()}-${i}`,
          type: t.type,
          x: Number.isFinite(+t.x) ? +t.x : (i % 5) * 40,
          y: Number.isFinite(+t.y) ? +t.y : (i % 5) * 40,
          w,
          // Audio tiles auto-fit their transcripts, so recompute height.
          h:
            t.type === "audio"
              ? transcript
                ? transcriptTileHeight(transcript, w)
                : AUDIO_H
              : Number.isFinite(+t.h) && +t.h > 0
                ? +t.h
                : 160,
          text: typeof t.text === "string" ? t.text : "",
          transcript,
          src: typeof t.src === "string" ? t.src : undefined,
          // Legacy text notes were saved with name "text" — treat as unnamed.
          name:
            typeof t.name === "string" &&
            !(t.type === "text" && t.name === "text")
              ? t.name
              : "",
          ratio:
            Number.isFinite(+t.ratio) && +t.ratio > 0 ? +t.ratio : undefined,
        };
      });
  } catch {
    return [];
  }
}

// Connection arrows mount with a CSS fade-in (animate-conn-in) and fade out
// on delete (leaving class). Geometry itself renders directly every frame —
// no tweening — so links track tiles exactly during drags and resizes.
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
  onTileResize,
  busyIds,
  onTileContextMenu,
  leavingIds,
  connections,
  selectedConnIds,
  leavingConnIds,
  selectConnection,
  openMenu,
  connecting,
  highlight,
}) {
  const ctx = useTransformContext();
  const controls = useControls();

  useEffect(() => {
    viewRef.current.wrapper = ctx.wrapperComponent;
    instanceRef.current = ctx;
    controlsRef.current = controls;
  }, [ctx, controls, viewRef, instanceRef, controlsRef]);

  const tileById = new Map(tiles.map((t) => [t.id, t]));
  // Pair laterals + crowded-edge endpoint spreading (one shared precompute).
  const connGeo = computeConnGeometry(connections, tileById);

  // Real bounding box around all tiles so the arrow layer has true
  // dimensions instead of relying on zero-size overflow painting.
  let bbX1 = Infinity;
  let bbY1 = Infinity;
  let bbX2 = -Infinity;
  let bbY2 = -Infinity;
  for (const t of tiles) {
    if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
    const w = Number.isFinite(t.w) ? t.w : 0;
    const h = Number.isFinite(t.h) ? t.h : 0;
    if (t.x < bbX1) bbX1 = t.x;
    if (t.y < bbY1) bbY1 = t.y;
    if (t.x + w > bbX2) bbX2 = t.x + w;
    if (t.y + h > bbY2) bbY2 = t.y + h;
  }
  if (!isFinite(bbX1)) {
    bbX1 = 0;
    bbY1 = 0;
    bbX2 = 0;
    bbY2 = 0;
  }
  const BB_PAD = 60;
  const bb = {
    x: bbX1 - BB_PAD,
    y: bbY1 - BB_PAD,
    w: bbX2 - bbX1 + BB_PAD * 2,
    h: bbY2 - bbY1 + BB_PAD * 2,
  };

  return (
    // Zero-size anchor: tiles are absolutely positioned, so the transform
    // layer stays tiny and pans at full framerate (no giant texture).
    <div className="relative h-0 w-0">
      {/* Connection arrows: above photos (10) and videos (20) so links are
          never hidden behind media, below audio (30) and text (40) so they
          don't cross readable content. Paths recompute from live tile
          geometry every render so they track drags. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: bb.x,
          top: bb.y,
          width: bb.w,
          height: bb.h,
          overflow: "visible",
          zIndex: 25,
        }}
      >
        <defs>
          <marker
            id="atless-conn-arrow"
            viewBox="0 0 10 10"
            refX="7.5"
            refY="5"
            markerWidth="6.5"
            markerHeight="6.5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: "var(--conn-stroke)" }} />
          </marker>
        </defs>
        <g transform={`translate(${-bb.x},${-bb.y})`}>
        {connections.map((c) => {
          const a = tileById.get(c.from);
          const b = tileById.get(c.to);
          if (!a || !b) return null;
          const geoShift = connGeo.laterals.get(c.id) || { x: 0, y: 0 };
          const pts = connectionPointsShifted(
            a,
            b,
            geoShift,
            connGeo.offsets.get(`${c.id}→${c.from}`) ?? 0,
            connGeo.offsets.get(`${c.id}→${c.to}`) ?? 0,
          );
          const sel = selectedConnIds.includes(c.id);
          const leaving = leavingConnIds.includes(c.id);
          return (
            <g key={c.id} className="animate-conn-in">
              {/* fat invisible hit area */}
              <path
                d={pointsToPath(pts)}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                className="conn-hit"
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.ctrlKey || e.metaKey) selectConnection(c.id, true);
                  else selectConnection(c.id, false);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openMenu({ x: e.clientX, y: e.clientY, id: c.id });
                }}
              />
              <path
                d={pointsToPath(pts)}
                fill="none"
                strokeWidth={1.5}
                strokeLinecap="round"
                markerEnd="url(#atless-conn-arrow)"
                className={leaving ? "opacity-0" : "opacity-100"}
                style={{
                  stroke: sel ? "var(--conn-sel)" : "var(--conn-stroke)",
                  transition: "opacity 150ms ease-out",
                  pointerEvents: "none",
                }}
              />
            </g>
          );
        })}
        </g>
      </svg>

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
          onTileResize,
          busy: busyIds.includes(tile.id),
          leaving: leavingIds.includes(tile.id),
          onTileContextMenu,
          connecting,
          highlight,
        };
        if (tile.type === "text") {
          return <TextNote key={tile.id} {...common} />;
        }
        if (tile.type === "audio") {
          return <AudioTile key={tile.id} {...common} />;
        }
        if (tile.type === "summary") {
          return (
            <Suspense
              key={tile.id}
              fallback={
                <div
                  aria-hidden="true"
                  className="absolute animate-pulse rounded-xl bg-white/60 dark:bg-stone-900/60"
                  style={{ left: tile.x, top: tile.y, width: tile.w, height: tile.h }}
                />
              }
            >
              <SummaryTile {...common} />
            </Suspense>
          );
        }
        return <MediaTile key={tile.id} {...common} />;
      })}
    </div>
  );
}

export default function App() {
  const [tiles, setTiles] = useState(loadTiles);
  const [connections, setConnections] = useState(() =>
    loadConnections(loadTiles()),
  );
  const connRef = useRef(0);
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
  const cardRef = useRef(null);
  const cardGlowRef = useRef(null);
  const glowTarget = useRef({ x: 0, y: 0 });
  const glowCur = useRef({ x: 0, y: 0 });

  // ---- tile selection (single click, ctrl-toggle, marquee box) ----
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedRef = useRef([]);
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  const connListRef = useRef(connections);
  connListRef.current = connections;
  const marqueeRef = useRef(null);
  const [marqueeBox, setMarqueeBox] = useState(null);
  // Pan mode indicator — grab cursor only while Shift is held.
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  // Snapshot of group positions taken when a tile drag starts.
  const groupDragRef = useRef(null);
  // Remembers the last quota warning so an oversized canvas warns once.
  const persistWarnRef = useRef(null);

  // ---- connection selection (independent from tile selection) ----
  const [selectedConnIds, setSelectedConnIds] = useState([]);
  const selectedConnRef = useRef([]);
  const [leavingConnIds, setLeavingConnIds] = useState([]);
  const connLeaveTimer = useRef(null);
  const pendingConnRemoveRef = useRef(new Set());

  const clearConnSelection = useCallback(() => {
    if (selectedConnRef.current.length === 0) return;
    selectedConnRef.current = [];
    setSelectedConnIds([]);
  }, []);

  const selectConnection = useCallback((id, additive) => {
    selectedRef.current = [];
    setSelectedIds([]);
    const cur = selectedConnRef.current;
    const next = additive
      ? cur.includes(id)
        ? cur.filter((x) => x !== id)
        : [...cur, id]
      : [id];
    selectedConnRef.current = next;
    setSelectedConnIds(next);
  }, []);

  const removeConns = useCallback((ids) => {
    const list = [...new Set(ids)];
    if (list.length === 0) return;
    for (const id of list) pendingConnRemoveRef.current.add(id);
    const kept = selectedConnRef.current.filter(
      (x) => !pendingConnRemoveRef.current.has(x),
    );
    selectedConnRef.current = kept;
    setSelectedConnIds(kept);
    setLeavingConnIds((prev) => [
      ...prev,
      ...list.filter((x) => !prev.includes(x)),
    ]);
    if (connLeaveTimer.current) clearTimeout(connLeaveTimer.current);
    connLeaveTimer.current = setTimeout(() => {
      const doomed = new Set(pendingConnRemoveRef.current);
      pendingConnRemoveRef.current.clear();
      setConnections((prev) => prev.filter((c) => !doomed.has(c.id)));
      setLeavingConnIds((prev) => prev.filter((x) => !doomed.has(x)));
    }, 180);
  }, []);

  const selectOnly = useCallback((id) => {
    selectedRef.current = [id];
    setSelectedIds([id]);
    clearConnSelection();
  }, [clearConnSelection]);

  const toggleSelect = useCallback((id) => {
    const next = selectedRef.current.includes(id)
      ? selectedRef.current.filter((x) => x !== id)
      : [...selectedRef.current, id];
    selectedRef.current = next;
    setSelectedIds(next);
    clearConnSelection();
  }, [clearConnSelection]);

  const clearSelection = useCallback(() => {
    if (
      selectedRef.current.length === 0 &&
      selectedConnRef.current.length === 0
    )
      return;
    selectedRef.current = [];
    setSelectedIds([]);
    clearConnSelection();
  }, [clearConnSelection]);

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
        (t.text || "").toLowerCase().includes(q) ||
        (t.transcript || "").toLowerCase().includes(q),
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

  // Jump to a connection: select the connection itself and fit both
  // tiles in view.
  const focusConnection = useCallback((conn) => {
    const byId = new Map(tilesRef.current.map((t) => [t.id, t]));
    const a = byId.get(conn.from);
    const b = byId.get(conn.to);
    if (!a || !b) return;
    selectConnection(conn.id, false);
    const setT = controlsRef.current?.setTransform;
    const inst = instanceRef.current;
    const wrapper = inst?.wrapperComponent;
    if (setT && wrapper && inst?.state) {
      const rect = wrapper.getBoundingClientRect();
      const pad = 140;
      const x1 = Math.min(a.x, b.x);
      const y1 = Math.min(a.y, b.y);
      const x2 = Math.max(a.x + a.w, b.x + b.w);
      const y2 = Math.max(a.y + a.h, b.y + b.h);
      const bw = Math.max(x2 - x1, 1);
      const bh = Math.max(y2 - y1, 1);
      const s = Math.min(
        Math.max(Math.min((rect.width - pad) / bw, (rect.height - pad) / bh), 0.2),
        1.5,
      );
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      try {
        void setT(
          rect.width / 2 - cx * s,
          rect.height / 2 - cy * s,
          s,
          400,
          "easeOut",
        );
      } catch {
        /* noop */
      }
    }
  }, [selectConnection]);

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

  // ---- Gemini Q&A: free-prompt pill (whole canvas) + per-tile Ask ----
  const [asking, setAsking] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askTileId, setAskTileId] = useState(null);
  const [askText, setAskText] = useState("");
  const askInputRef = useRef(null);
  const askPillRef = useRef(null);

  const openAskPill = useCallback((tileId) => {
    setAskTileId(tileId || null);
    setAskText("");
    setAskOpen(true);
  }, []);

  const closeAskPill = useCallback(() => {
    setAskOpen(false);
    setAskText("");
  }, []);

  const toggleAskPill = useCallback(() => {
    if (askOpen) closeAskPill();
    else openAskPill(null);
  }, [askOpen, closeAskPill, openAskPill]);

  useEffect(() => {
    if (!askOpen) return;
    const t = setTimeout(() => askInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [askOpen]);

  // Clicking anywhere off the pill dismisses it — except the header toggle
  // button (its click handles that) and except while Gemini is thinking, so
  // a stray canvas click can't kill an in-flight answer.
  useEffect(() => {
    if (!askOpen || asking) return;
    const onDown = (e) => {
      if (e.target.closest?.("[data-ask-toggle]")) return;
      if (!askPillRef.current?.contains(e.target)) closeAskPill();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [askOpen, asking, closeAskPill]);

  const askGemini = useCallback(async () => {
    const question = askText.trim();
    if (asking || !question) return;
    const scope = askTileId
      ? tilesRef.current.filter((t) => t.id === askTileId)
      : [...tilesRef.current];
    if (askTileId && scope.length === 0) {
      showToast("That tile is gone — ask about the canvas instead", 4000);
      return;
    }
    const { lines, parts } = collectTileContext(scope);
    if (lines.length === 0 && parts.length === 0) {
      showToast(
        askTileId
          ? "This tile has no content to ask about"
          : "Add some tiles first to ask about!",
        4000,
      );
      return;
    }
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) {
      showToast("Missing VITE_GEMINI_API_KEY — add it to .env locally or GitHub Secrets for atless.tech", 4000);
      return;
    }
    const scoped = askTileId !== null;
    setAsking(true);
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
                  text: scoped
                    ? "You are looking at a single tile from the user's spatial canvas. Answer only about this tile: its text, transcript, image, or recording as provided. Answer the question directly. Format with GitHub-flavored Markdown (headings, bullets, tables, code blocks where they help). Typeset math with LaTeX: $...$ inline, $$...$$ display."
                    : "You are a spatial canvas AI assistant. The user asks about everything on their canvas: text notes, audio transcripts and recordings, images, and video references are provided below. Answer the question directly using anything relevant. Format with GitHub-flavored Markdown (headings, bullets, tables, code blocks where they help). Typeset math with LaTeX: $...$ inline, $$...$$ display.",
                },
              ],
            },
            contents: [{ parts: [...parts, { text: `${lines.join("\n")}\n\nQuestion: ${question}` }] }],
            generationConfig: { temperature: scoped ? 0.4 : 0.7, maxOutputTokens: 2048 },
          }),
        },
      );
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          const msg = errJson?.error?.message;
          if (msg && typeof msg === "string") detail += ` — ${msg}`;
          console.error("Gemini ask error:", res.status, errJson);
        } catch {
          console.error("Gemini ask error:", res.status);
        }
        throw new Error(detail);
      }
      const json = await res.json();
      const answer = extractGeminiText(json).trim();
      if (!answer) {
        showToast("Gemini returned an empty answer");
        return;
      }
      let x = 0;
      let y = 0;
      if (scoped) {
        const anchor = scope[0];
        x = anchor.x + anchor.w + 24;
        y = anchor.y;
      } else {
        const wrapper =
          viewRef.current.wrapper ?? instanceRef.current?.wrapperComponent;
        if (wrapper) {
          const rect = wrapper.getBoundingClientRect();
          const p = clientToContent(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          x = p.x - SUM_W / 2;
          y = p.y - SUM_H / 2;
        }
      }
      setTiles((prev) => [
        ...prev,
        {
          id: nextId("summary"),
          type: "summary",
          x,
          y,
          w: SUM_W,
          h: SUM_H,
          text: answer,
          name: question.length > 60 ? `${question.slice(0, 60)}…` : question,
        },
      ]);
      closeAskPill();
      showToast("Answer ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Ask failed (${msg || "network error"})`, 4000);
    } finally {
      setAsking(false);
    }
  }, [asking, askText, askTileId, showToast, clientToContent, nextId, closeAskPill]);

  // ---- shareable canvas links (Worker + Tiger Data, editable copy) ----
  const [sharing, setSharing] = useState(false);

  // Easter-egg otter (unlocked via the credits in the shortcut menu).
  // Session-only on purpose — a reload dismisses it. Missing gif fails
  // silently.
  const [otterOn, setOtterOn] = useState(false);
  const setOtter = useCallback((v) => {
    setOtterOn(v);
  }, []);

  const shareCanvas = useCallback(async () => {
    if (sharing) return;
    const api = import.meta.env.VITE_SHARE_API_URL;
    if (!api) {
      showToast("Share API not configured — add VITE_SHARE_API_URL", 4000);
      return;
    }
    const live = tilesRef.current;
    if (live.length === 0) {
      showToast("Add some tiles first to share!");
      return;
    }
    // blob: URLs die with the tab — strip them so shared media never 404s.
    const cleanTiles = live.map((t) => ({
      ...t,
      src:
        typeof t.src === "string" && !t.src.startsWith("blob:")
          ? t.src
          : undefined,
    }));
    const ids = new Set(cleanTiles.map((t) => t.id));
    const cleanConns = connections.filter(
      (c) => ids.has(c.from) && ids.has(c.to),
    );
    const payload = JSON.stringify({
      version: 1,
      tiles: cleanTiles,
      connections: cleanConns,
    });
    if (payload.length > 15_000_000) {
      showToast(
        "Canvas too large to share — remove some media (uploads coming soon)",
        5000,
      );
      return;
    }
    setSharing(true);
    try {
      const res = await fetch(`${String(api).replace(/\/$/, "")}/api/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          if (j?.error) detail = j.error;
        } catch {
          /* keep status */
        }
        throw new Error(detail);
      }
      const { id } = await res.json();
      const link = `${window.location.origin}${window.location.pathname}#/s/${id}`;
      try {
        await navigator.clipboard.writeText(link);
        showToast("Share link copied to clipboard");
      } catch {
        showToast(`Copy this link: ${link}`, 8000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Share failed (${msg || "network error"})`, 4000);
    } finally {
      setSharing(false);
    }
  }, [sharing, showToast, connections]);

  // Opening a share link (#/s/<id>) loads that exact canvas as an editable
  // local copy, then drops the hash so refresh falls back to autosave.
  useEffect(() => {
    const m = window.location.hash.match(/^#\/s\/([A-Za-z0-9_-]{8,32})/);
    if (!m) return;
    const api = import.meta.env.VITE_SHARE_API_URL;
    if (!api) {
      showToast("Share API not configured — cannot load this link", 4000);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${String(api).replace(/\/$/, "")}/api/shares/${m[1]}`,
        );
        if (!res.ok)
          throw new Error(
            res.status === 404 ? "link not found" : `HTTP ${res.status}`,
          );
        const data = await res.json();
        if (
          !data ||
          !Array.isArray(data.tiles) ||
          !Array.isArray(data.connections)
        )
          throw new Error("bad payload");
        const types = new Set([
          "text",
          "image",
          "video",
          "audio",
          "youtube",
          "summary",
        ]);
        const loaded = [];
        for (const t of data.tiles) {
          if (!t || typeof t.id !== "string" || !types.has(t.type)) continue;
          const w =
            Number.isFinite(+t.w) && +t.w > 0 ? +t.w : NOTE_W;
          const transcript =
            typeof t.transcript === "string" ? t.transcript : "";
          loaded.push({
            id: t.id,
            type: t.type,
            x: Number.isFinite(+t.x) ? +t.x : 0,
            y: Number.isFinite(+t.y) ? +t.y : 0,
            w,
            h:
              t.type === "audio"
                ? transcript
                  ? transcriptTileHeight(transcript, w)
                  : AUDIO_H
                : Number.isFinite(+t.h) && +t.h > 0
                  ? +t.h
                  : 160,
            text: typeof t.text === "string" ? t.text : "",
            transcript,
            src:
              typeof t.src === "string" && !t.src.startsWith("blob:")
                ? t.src
                : undefined,
            name: typeof t.name === "string" ? t.name : "",
            ratio:
              Number.isFinite(+t.ratio) && +t.ratio > 0
                ? +t.ratio
                : undefined,
          });
        }
        if (loaded.length === 0) throw new Error("empty canvas");
        const liveIds = new Set(loaded.map((t) => t.id));
        const seen = new Set();
        const conns = [];
        for (const c of data.connections) {
          if (
            !c ||
            typeof c.from !== "string" ||
            typeof c.to !== "string" ||
            c.from === c.to ||
            !liveIds.has(c.from) ||
            !liveIds.has(c.to)
          )
            continue;
          const k = `${c.from}→${c.to}`;
          if (seen.has(k)) continue;
          seen.add(k);
          conns.push({
            id: typeof c.id === "string" ? c.id : `conn-${c.from}-${c.to}`,
            from: c.from,
            to: c.to,
          });
        }
        setTiles(loaded);
        setConnections(conns);
        selectedRef.current = [];
        setSelectedIds([]);
        clearConnSelection();
        showToast("Shared canvas loaded — editable copy saved locally");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Could not load shared canvas (${msg})`, 4000);
      } finally {
        try {
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
          );
        } catch {
          /* noop */
        }
      }
    })();
  }, []);

  // ---- tile connections: pick a source from its menu, then click a target ----
  const [connecting, setConnecting] = useState(null); // source tile id

  const clearToast = useCallback(() => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    setToast(null);
  }, []);

  const cancelConnecting = useCallback(() => {
    setConnecting(null);
    clearToast();
  }, [clearToast]);

  const createConnection = useCallback((fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    setConnections((prev) => {
      // Directed: A→B and B→A are distinct links sharing one curve.
      if (prev.some((c) => c.from === fromId && c.to === toId)) return prev;
      connRef.current += 1;
      return [
        ...prev,
        { id: `conn-${Date.now()}-${connRef.current}`, from: fromId, to: toId },
      ];
    });
  }, []);

  useEffect(() => {
    if (!connecting) return;
    const onKey = (e) => {
      if (e.key === "Escape") cancelConnecting();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connecting, cancelConnecting]);

  // Runs on tile mousedown (bubbles up from the drag handle — never blocked,
  // so Rnd still receives it). Ctrl/Cmd toggles, otherwise select exclusively.
  const handleTileMouseDown = useCallback(
    (id, e) => {
      if (connecting) {
        if (id !== connecting) {
          createConnection(connecting, id);
          showToast("Tiles connected");
          selectOnly(id);
        } else {
          clearToast();
        }
        setConnecting(null);
        return;
      }
      if (e.target.closest?.(".no-drag")) return;
      if (e.ctrlKey || e.metaKey) toggleSelect(id);
      else if (!selectedRef.current.includes(id)) selectOnly(id);
    },
    [connecting, createConnection, showToast, clearToast, selectOnly, toggleSelect],
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
    // Move the whole group live — including the dragged tile itself, using
    // the exact values Rnd already holds, so nothing fights or jumps.
    setTiles((prev) =>
      prev.map((t) =>
        snap.ids.includes(t.id)
          ? { ...t, x: snap.atStart[t.id].x + dx, y: snap.atStart[t.id].y + dy }
          : t,
      ),
    );
  }, []);

  // Live-resize: stream Rnd's in-progress size into state so connected
  // arrows track the tile in realtime (same controlled pattern as dragging).
  const handleTileResize = useCallback((id, w, h, x, y) => {
    setTiles((prev) =>
      prev.map((t) => (t.id === id ? { ...t, w, h, x, y } : t)),
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
  const handleWrapperMouseDown = useCallback(
    (e) => {
      if (e.button !== 0 || e.shiftKey) return;
      if (connecting) {
        cancelConnecting();
        return;
      }
      if (e.target.closest?.(".tile-rnd")) return;
      if (isEditableTarget(e)) return;
      e.preventDefault();
      marqueeRef.current = {
        x1: e.clientX,
        y1: e.clientY,
        ctrl: e.ctrlKey || e.metaKey,
        moved: false,
      };
    },
    [connecting, cancelConnecting],
  );

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
      // Links get selected when both endpoints land in the box OR the
      // curve itself passes through it — so boxing just a line works.
      const hitSet = new Set(hit);
      const byId = new Map(tilesRef.current.map((t) => [t.id, t]));
      const box = { x1: rx1, y1: ry1, x2: rx2, y2: ry2 };
      const geo = computeConnGeometry(connListRef.current, byId);
      const hitConns = connListRef.current
        .filter((c) => {
          if (hitSet.has(c.from) && hitSet.has(c.to)) return true;
          const a = byId.get(c.from);
          const b = byId.get(c.to);
          if (!a || !b) return false;
          return connectionHitsRect(
            a,
            b,
            box,
            geo.laterals.get(c.id) || { x: 0, y: 0 },
            geo.offsets.get(`${c.id}→${c.from}`) ?? 0,
            geo.offsets.get(`${c.id}→${c.to}`) ?? 0,
          );
        })
        .map((c) => c.id);
      const nextConns = m.ctrl
        ? Array.from(new Set([...selectedConnRef.current, ...hitConns]))
        : hitConns;
      selectedConnRef.current = nextConns;
      setSelectedConnIds(nextConns);
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
      setConnections((prev) =>
        prev.filter((c) => !doomed.has(c.from) && !doomed.has(c.to)),
      );
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
        clearConnSelection();
        return;
      }
      if (e.key !== "Delete") return;
      if (isEditableTarget(e)) return;
      if (
        selectedRef.current.length === 0 &&
        selectedConnRef.current.length === 0
      )
        return;
      e.preventDefault();
      deleteSelected();
      removeConns(selectedConnRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, removeConns, clearConnSelection]);

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
          "Missing VITE_ELEVENLABS_API_KEY — add it to .env locally or GitHub Secrets for atless.tech",
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
          "Missing VITE_ELEVENLABS_API_KEY — add it to .env locally or GitHub Secrets for atless.tech",
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
          h: transcriptTileHeight(text, tile.w || AUDIO_W),
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

  // ---- right-click tile menu ----
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
    if (!t) return;
    // Every tile type gets a menu — TileMenu only shows the actions that
    // apply (Make connection + Delete always render).
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

  // Connections are tiny — plain debounced save, no quota gymnastics.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(CONN_KEY, JSON.stringify(connections));
      } catch (err) {
        console.warn("Could not persist connections:", err);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [connections]);

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

  // Microphone stream cache: acquiring the device takes hundreds of ms,
  // so keep it warm (first gesture) and re-warm after every take.
  const micStreamRef = useRef(null);
  const micPromiseRef = useRef(null);

  const getMicStream = useCallback(() => {
    const live = micStreamRef.current;
    if (
      live &&
      live.active &&
      live.getAudioTracks().some((t) => t.readyState === "live")
    ) {
      return Promise.resolve(live);
    }
    if (!micPromiseRef.current) {
      micPromiseRef.current = navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          micStreamRef.current = stream;
          stream.getAudioTracks().forEach((t) => {
            t.onended = () => {
              if (micStreamRef.current === stream) micStreamRef.current = null;
            };
          });
          return stream;
        })
        .finally(() => {
          micPromiseRef.current = null;
        });
    }
    return micPromiseRef.current;
  }, []);

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
      const stream = await getMicStream();
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
        // Re-warm the mic in the background so the next take starts instantly.
        void getMicStream().catch(() => {});
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
  }, [nextId, stopTimer, clientToContent, viewportCenterContent, getMicStream]);

  // Track the cursor so recordings can land where the pointer is.
  // Also drives the welcome card's cursor-following glow.
  useEffect(() => {
    const onMove = (e) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
      const card = cardRef.current;
      const glow = cardGlowRef.current;
      if (!card || !glow) return;
      const r = card.getBoundingClientRect();
      const inside =
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom;
      if (inside) {
        glowTarget.current.x = e.clientX - r.left;
        glowTarget.current.y = e.clientY - r.top;
        if (!glow.classList.contains("on")) {
          // Snap on entry so it never sweeps in from a stale spot.
          glowCur.current.x = glowTarget.current.x;
          glowCur.current.y = glowTarget.current.y;
        }
        glow.classList.add("on");
      } else {
        glow.classList.remove("on");
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // Eased follower for the card glow: trails the pointer instead of snapping.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const glow = cardGlowRef.current;
      if (!glow) return;
      const t = glowTarget.current;
      const c = glowCur.current;
      c.x += (t.x - c.x) * 0.055;
      c.y += (t.y - c.y) * 0.055;
      if (Math.abs(t.x - c.x) < 0.1 && Math.abs(t.y - c.y) < 0.1) return;
      glow.style.setProperty("--mx", `${c.x}px`);
      glow.style.setProperty("--my", `${c.y}px`);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
    // 0 = light palette, 1 = dark. Eases toward the live theme on every drawn
    // frame so the background glides through a theme flip instead of snapping.
    let mix = document.documentElement.classList.contains("dark") ? 1 : 0;
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
      const target = document.documentElement.classList.contains("dark") ? 1 : 0;
      // Drawn frames land ~66ms apart, so this sweeps the palette in ~200ms —
      // the same duration as the CSS crossover.
      mix += Math.max(-0.33, Math.min(0.33, target - mix));
      if (Math.abs(target - mix) < 0.002) mix = target;
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
          const aLight = 0.4 + idx * 0.05 + glow * 0.45;
          const aDark = 0.12 + idx * 0.03 + glow * 0.4;
          const a = aLight + (aDark - aLight) * mix;
          ctx.globalAlpha = a > 1 ? 1 : a;
          // #a8a29e (light) → #ffffff (dark)
          ctx.fillStyle = `rgb(${Math.round(168 + 87 * mix)},${Math.round(162 + 93 * mix)},${Math.round(158 + 97 * mix)})`;
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

  // Warm the microphone on first interaction so recording starts instantly.
  useEffect(() => {
    const warm = () => {
      void getMicStream().catch(() => {});
    };
    window.addEventListener("pointerdown", warm, { once: true });
    window.addEventListener("keydown", warm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", warm);
      window.removeEventListener("keydown", warm);
    };
  }, [getMicStream]);

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
      {/* Easter-egg otter: viewport-anchored bottom-right, floating above
          tiles but below UI chrome, never intercepting clicks.
          Drop the gif at public/otter.gif — without it this renders nothing. */}
      {otterOn && (
        <img
          src={`${import.meta.env.BASE_URL}otter.gif`}
          alt=""
          aria-hidden="true"
          draggable={false}
          onError={() => setOtter(false)}
          className="animate-otter pointer-events-none fixed right-6 bottom-6 z-[45] h-[88px] w-auto max-w-[110px] rounded-2xl select-none"
        />
      )}
      <TopPillHeader
        onAskGemini={toggleAskPill}
        onShare={shareCanvas}
        sharing={sharing}
        otterOn={otterOn}
        onOtterChange={setOtter}
        tiles={tiles}
        connections={connections}
        onFocusConnection={focusConnection}
      />

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

      {askOpen &&
        (() => {
          const askTile = askTileId
            ? tiles.find((t) => t.id === askTileId)
            : null;
          return (
            <div
              ref={askPillRef}
              className="gemini-surface-wide absolute top-20 left-1/2 z-50 flex w-[min(440px,92vw)] -translate-x-1/2 animate-fade-slide-in items-center gap-2 rounded-full border border-white/60 py-1.5 pr-2 pl-3.5 shadow-lg ring-1 ring-black/5 backdrop-blur-xl dark:border-white/10 dark:ring-white/10"
            >
              <GeminiIcon size={15} className="shrink-0" />
              <input
                ref={askInputRef}
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    askGemini();
                  } else if (e.key === "Escape") {
                    closeAskPill();
                  }
                }}
                placeholder={
                  askTile
                    ? `Ask about ${tileDisplayName(askTile)}…`
                    : "Ask about your canvas…"
                }
                spellCheck={false}
                disabled={asking}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-stone-800 outline-none placeholder:text-neutral-400 disabled:opacity-60 dark:text-stone-100 dark:placeholder:text-stone-500"
              />
              <button
                onClick={askGemini}
                disabled={asking || !askText.trim()}
                aria-label="Send question to Gemini"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-900 text-white outline-none transition hover:opacity-80 active:scale-90 disabled:opacity-40 dark:bg-white dark:text-stone-900"
              >
                {asking ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Send size={13} className="-translate-x-px translate-y-px" />
                )}
              </button>
            </div>
          );
        })()}

      <div
        className="transform-wrapper-fill absolute inset-0"
        onDoubleClick={handleEmptyDoubleClick}
        onMouseDown={handleWrapperMouseDown}
        onMouseDownCapture={(e) => {
          // Complete pending connections from ANY tile press — textareas and
          // controls stop bubbling, so the bubble path can't be trusted here.
          // Capture runs top-down first and can't be blocked.
          if (connecting) {
            const el = e.target.closest?.(".tile");
            const id = el?.dataset?.tileId;
            if (id) {
              e.stopPropagation();
              e.preventDefault();
              if (id !== connecting) {
                createConnection(connecting, id);
                const aname =
                  tiles.find((t) => t.id === connecting)?.name || "Tile";
                const bname = tiles.find((t) => t.id === id)?.name || "Tile";
                showToast(`${aname} → ${bname} connected`);
                selectOnly(id);
              } else {
                clearToast();
              }
              setConnecting(null);
            }
          }
          blurActiveText(e);
        }}
        onClickCapture={(e) => {
          // Fallback completion: if the mousedown phase was swallowed
          // anywhere upstream, a genuine click still lands the connection.
          // (When mousedown already completed, `connecting` is null here.)
          if (!connecting) return;
          const el = e.target.closest?.(".tile");
          const id = el?.dataset?.tileId;
          if (!id || id === connecting) return;
          createConnection(connecting, id);
          const aname =
            tiles.find((t) => t.id === connecting)?.name || "Tile";
          const bname = tiles.find((t) => t.id === id)?.name || "Tile";
          showToast(`${aname} → ${bname} connected`);
          selectOnly(id);
          setConnecting(null);
        }}
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
            wrapperClass={`!w-full !h-full ${connecting ? "cursor-crosshair" : isShiftPressed ? "cursor-grab active:cursor-grabbing" : "cursor-default"}`}
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
              onTileResize={handleTileResize}
              busyIds={busyIds}
              leavingIds={leavingIds}
              connections={connections}
              selectedConnIds={selectedConnIds}
              leavingConnIds={leavingConnIds}
              selectConnection={selectConnection}
              openMenu={openMenu}
              onTileContextMenu={handleTileContextMenu}
              connecting={connecting}
              highlight={searchOpen ? query.trim() : ""}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>

      {tiles.length === 0 && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-40 -translate-x-1/2 -translate-y-1/2 animate-fade-in">
          <div
            aria-hidden="true"
            className="welcome-glow absolute -inset-px rounded-[20px]"
          />
          <div ref={cardRef} className="relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl border border-neutral-200/70 bg-white/60 px-14 py-12 text-center shadow-sm backdrop-blur-sm select-none dark:border-white/10 dark:bg-stone-900/60">
          <div
            ref={cardGlowRef}
            aria-hidden="true"
            className="card-cursor-glow pointer-events-none absolute inset-0 text-blue-500 dark:text-amber-500"
          />
          <p className="font-display text-5xl font-medium text-neutral-600 dark:text-stone-200">Welcome to <span className="font-bold">Atless</span>.</p>
          <p className="max-w-[440px] text-xl leading-relaxed text-balance text-neutral-400 dark:text-stone-500">
            more productivity, <span className="font-bold">less clutter.</span>
          </p>
          <p className="text-base text-neutral-400 dark:text-stone-500">
            double-click anywhere to begin
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
          const cc = connections.find((x) => x.id === menu.id);
          if (cc) {
            return (
              <div
                role="menu"
                aria-label="Connection actions"
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className={`tile-menu fixed z-[60] w-48 rounded-2xl border border-white/60 bg-white/85 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur-xl transition-all duration-150 origin-top-left dark:border-white/10 dark:bg-stone-900/90 dark:ring-white/10 ${
                  menuShown ? "scale-100 opacity-100" : "pointer-events-none scale-[0.97] opacity-0"
                }`}
                style={{
                  left: Math.max(8, Math.min(menu.x, window.innerWidth - 200)),
                  top: Math.max(8, Math.min(menu.y, window.innerHeight - 80)),
                }}
              >
                <button
                  onClick={() => {
                    const id = cc.id;
                    closeMenu();
                    // Deleting from a multi-selection removes the whole group.
                    if (
                      selectedConnRef.current.includes(id) &&
                      selectedConnRef.current.length > 1
                    ) {
                      removeConns(selectedConnRef.current);
                    } else {
                      removeConns([id]);
                    }
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-red-500 transition outline-none hover:bg-red-500/10 dark:text-red-400"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-stone-400">
                    <Trash2 size={13} />
                  </span>
                  Delete
                </button>
              </div>
            );
          }
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
              onAsk={() => {
                closeMenu();
                openAskPill(t.id);
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
              onConnect={() => {
                closeMenu();
                setConnecting(t.id);
                showToast("Click another tile to connect — Esc to cancel", 30000);
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
