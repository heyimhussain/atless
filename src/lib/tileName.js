// Display name for a tile: custom name first, then the first word of a text
// note's content, then a per-type fallback. Used by tile headers and the
// connections panel so unnamed notes are still recognizable.
export function tileDisplayName(t) {
  if (!t) return "?";
  if (t.name) return t.name;
  if (t.type === "text") {
    const first = (t.text || "").trim().split(/\s+/).filter(Boolean)[0];
    if (first) return first.length > 24 ? `${first.slice(0, 24)}…` : first;
  }
  return (
    {
      text: "Text note",
      image: "Image",
      video: "Video",
      audio: "Voice note",
      youtube: "YouTube",
      summary: "Summary",
    }[t.type] || t.type
  );
}

// First-word fallback for a text tile's header, or null when the note is
// empty (the "double-click to rename" hint shows instead).
export function textTileFirstWord(tile) {
  if (!tile || tile.type !== "text" || tile.name) return null;
  const first = (tile.text || "").trim().split(/\s+/).filter(Boolean)[0];
  if (!first) return null;
  return first.length > 24 ? `${first.slice(0, 24)}…` : first;
}
