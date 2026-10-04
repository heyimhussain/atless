// Split text into plain runs and <mark> runs for search highlighting.
// Case-insensitive; colors match the selection glow/edges (blue in light
// mode, amber in dark mode).
export function highlightParts(text, q) {
  const src = String(text ?? "");
  const needle = String(q ?? "").trim();
  if (!needle) return src;
  const lower = src.toLowerCase();
  const n = needle.toLowerCase();
  const parts = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const j = lower.indexOf(n, i);
    if (j === -1) break;
    if (j > i) parts.push(src.slice(i, j));
    parts.push(
      <mark
        key={k++}
        className="rounded-[3px] bg-[rgba(59,130,246,0.3)] px-px text-inherit dark:bg-[rgba(250,160,22,0.4)]"
      >
        {src.slice(j, j + n.length)}
      </mark>,
    );
    i = j + n.length;
  }
  if (i < src.length) parts.push(src.slice(i));
  return parts;
}
