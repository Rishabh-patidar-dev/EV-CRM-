"use client";

// ============================================================================
// GlobalSearch — staff CRM top bar
// ============================================================================
// Every record type a staff member can reach anywhere in the app, across
// every dealer — debounced, grouped by type, keyboard-navigable (↑/↓/Enter/
// Esc), opens with Ctrl/Cmd+K from anywhere. Most record types have a real
// detail page; a handful (invoices, vehicle inventory, purchase orders/
// invoices) have none yet, so those results land on their list page with a
// `?q=` deep link instead (see lib/useDeepLinkQuery.ts).
// Mirrors DMS's GlobalSearch (DMS/src/components/portal/GlobalSearch.tsx) —
// same UX, adapted to this app's axios client and shadcn-style tokens.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, ArrowRight, X } from "lucide-react";
import apiClient from "@/lib/api/client";

interface SearchResult {
  id: number;
  title: string;
  subtitle: string;
  href: string;
}
interface SearchGroup {
  type: string;
  label: string;
  results: SearchResult[];
}

export default function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const flatResults = useMemo(
    () => groups.flatMap((g) => g.results.map((r) => ({ group: g, result: r }))),
    [groups]
  );

  const runSearch = useCallback((q: string) => {
    if (q.trim().length < 2) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    apiClient
      .get("/api/v1/search", { params: { q: q.trim() } })
      .then((res) => setGroups(res.data.groups ?? []))
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, []);

  // Debounced as-you-type — 250ms, cancels any in-flight timer on every
  // keystroke so only the latest query's request actually fires.
  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 250);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  useEffect(() => setActiveIndex(0), [groups]);

  // Ctrl/Cmd+K to jump in from anywhere in the dashboard; Escape backs out.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      } else if (e.key === "Escape" && open) {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function go(result: SearchResult) {
    router.push(result.href);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = flatResults[activeIndex];
      if (picked) go(picked.result);
    }
  }

  const showPanel = open && query.trim().length >= 2;
  let runningIndex = -1;

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <div
        className="flex min-w-0 items-center gap-2 rounded-md px-3 py-1.5 transition-colors"
        style={{ backgroundColor: "var(--muted)" }}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search dealers, invoices, orders, anything…"
          className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : query ? (
          <button
            onClick={() => {
              setQuery("");
              setGroups([]);
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd
            className="hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline"
            style={{ borderColor: "var(--border)" }}
          >
            ⌘K
          </kbd>
        )}
      </div>

      {showPanel && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] overflow-y-auto rounded-[var(--radius)] border bg-card p-2 shadow-lg"
          style={{ borderColor: "var(--border)" }}
        >
          {loading && groups.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : groups.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No matches for &ldquo;{query}&rdquo;.</div>
          ) : (
            groups.map((g) => (
              <div key={g.type} className="mb-1 last:mb-0">
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</div>
                {g.results.map((r) => {
                  runningIndex += 1;
                  const isActive = runningIndex === activeIndex;
                  return (
                    <button
                      key={`${g.type}-${r.id}`}
                      onMouseEnter={() => setActiveIndex(runningIndex)}
                      onClick={() => go(r)}
                      className="flex w-full items-center justify-between gap-3 rounded-[var(--radius)] px-3 py-2.5 text-left transition-colors"
                      style={isActive ? { backgroundColor: "var(--accent)" } : undefined}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>
                      </span>
                      <ArrowRight className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-primary opacity-100" : "text-muted-foreground opacity-0"}`} />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
