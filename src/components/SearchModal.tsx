import { useEffect, useRef, useState, useCallback } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

const MARK_CLASS = "__search-highlight__";
const MARK_ACTIVE_CLASS = "__search-highlight-active__";

function clearHighlights() {
  document.querySelectorAll(`mark.${MARK_CLASS}`).forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  });
}

function buildMarks(query: string): HTMLElement[] {
  clearHighlights();
  if (!query) return [];

  const marks: HTMLElement[] = [];
  const lower = query.toLowerCase();
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        if (el.closest("[data-search-overlay]")) return NodeFilter.FILTER_REJECT;
        if (el.closest("script, style, noscript")) return NodeFilter.FILTER_REJECT;
        if (!node.textContent) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    const ltext = text.toLowerCase();
    let idx = 0;
    let start = ltext.indexOf(lower, idx);
    if (start === -1) continue;

    const frag = document.createDocumentFragment();
    while (start !== -1) {
      if (start > idx) {
        frag.appendChild(document.createTextNode(text.slice(idx, start)));
      }
      const mark = document.createElement("mark");
      mark.className = MARK_CLASS;
      mark.textContent = text.slice(start, start + lower.length);
      frag.appendChild(mark);
      marks.push(mark);
      idx = start + lower.length;
      start = ltext.indexOf(lower, idx);
    }
    if (idx < text.length) {
      frag.appendChild(document.createTextNode(text.slice(idx)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return marks;
}

export default function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [marks, setMarks] = useState<HTMLElement[]>([]);
  const [current, setCurrent] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      clearHighlights();
      setQuery("");
      setMarks([]);
      setCurrent(-1);
    }
  }, [open]);

  useEffect(() => {
    const id = "__search-highlight-styles__";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      mark.${MARK_CLASS} {
        background: hsl(48 96% 53% / 0.55);
        color: inherit;
        border-radius: 2px;
        padding: 0 1px;
      }
      mark.${MARK_ACTIVE_CLASS} {
        background: hsl(48 96% 53%);
        color: #000;
        border-radius: 2px;
        padding: 0 1px;
        outline: 2px solid hsl(48 96% 70%);
      }
    `;
    document.head.appendChild(style);
  }, []);

  const scrollTo = useCallback((idx: number, allMarks: HTMLElement[]) => {
    if (!allMarks.length) return;
    allMarks.forEach(m => m.classList.remove(MARK_ACTIVE_CLASS));
    const target = allMarks[idx];
    if (!target) return;
    target.classList.add(MARK_ACTIVE_CLASS);
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const runSearch = useCallback((q: string) => {
    const newMarks = buildMarks(q);
    setMarks(newMarks);
    const idx = newMarks.length > 0 ? 0 : -1;
    setCurrent(idx);
    if (idx !== -1) scrollTo(idx, newMarks);
  }, [scrollTo]);

  const navigate = useCallback((dir: 1 | -1) => {
    if (!marks.length) return;
    const next = (current + dir + marks.length) % marks.length;
    setCurrent(next);
    scrollTo(next, marks);
  }, [current, marks, scrollTo]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    if (e.key === "Enter") { e.preventDefault(); navigate(e.shiftKey ? -1 : 1); }
    if (e.key === "F3") { e.preventDefault(); navigate(e.shiftKey ? -1 : 1); }
  };

  if (!open) return null;

  const label = marks.length === 0
    ? (query ? "No results" : "")
    : `${current + 1} / ${marks.length}`;

  return (
    <div
      data-search-overlay
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border bg-popover shadow-xl"
      style={{ minWidth: 280 }}
      onKeyDown={onKeyDown}
    >
      <input
        ref={inputRef}
        type="text"
        placeholder="Find on page…"
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          runSearch(e.target.value);
        }}
        className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none min-w-0"
      />

      {query && (
        <span className={`text-[10px] font-mono shrink-0 ${marks.length === 0 ? "text-destructive" : "text-muted-foreground"}`}>
          {label}
        </span>
      )}

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => navigate(-1)}
          disabled={marks.length === 0}
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
          title="Previous (Shift+Enter)"
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button
          onClick={() => navigate(1)}
          disabled={marks.length === 0}
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
          title="Next (Enter)"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Close (Esc)"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
