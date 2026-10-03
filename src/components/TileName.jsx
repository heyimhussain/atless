import { useEffect, useRef, useState } from "react";

// Inline rename field shown in a tile's drag-handle bar.
// onCommit(value): string to save, null when cancelled (Escape).
export default function TileName({ name, placeholder, onCommit }) {
  const [draft, setDraft] = useState(name || "");
  const inputRef = useRef(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = (value) => onCommit(value);

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(draft.trim());
        else if (e.key === "Escape") commit(null);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      placeholder={placeholder}
      spellCheck={false}
      className="no-drag min-w-0 flex-1 truncate bg-transparent text-[11px] text-stone-700 outline-none placeholder:text-neutral-300 dark:text-stone-200 dark:placeholder:text-stone-600"
    />
  );
}

// Faint hint rendered in the handle bar when a tile has no custom name.
export function NameHint() {
  return (
    <span className="truncate text-[11px] italic opacity-60">
      Double-click to rename
    </span>
  );
}
