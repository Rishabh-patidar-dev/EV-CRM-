"use client";

// Visual-only language picker matching the reference design — selecting an
// option updates the displayed label but doesn't translate the app (no i18n
// infrastructure exists here). Honest about that scope: it's a UI affordance,
// not a claim of working localization.
import { useEffect, useRef, useState } from "react";
import { Globe, Check, ChevronDown } from "lucide-react";

type LangOption = { code: string; label: string };
const GLOBAL: LangOption[] = [
  { code: "en-global", label: "English · Global" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
];
const REGIONAL_INDIA: LangOption[] = [
  { code: "en-in", label: "English · India" },
  { code: "hi", label: "Hindi" },
  { code: "mr", label: "Marathi" },
];

export default function LanguageSwitcher() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<LangOption>(GLOBAL[0]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        style={{ borderColor: "var(--border)" }}
      >
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        {selected.label}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-1.5 w-52 overflow-hidden rounded-md border bg-popover shadow-lg"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Global
          </div>
          {GLOBAL.map((opt) => (
            <LangRow key={opt.code} opt={opt} selected={selected} onSelect={(o) => { setSelected(o); setOpen(false); }} />
          ))}
          <div className="mt-1 border-t px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ borderColor: "var(--border)" }}>
            Regional · India
          </div>
          {REGIONAL_INDIA.map((opt) => (
            <LangRow key={opt.code} opt={opt} selected={selected} onSelect={(o) => { setSelected(o); setOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function LangRow({ opt, selected, onSelect }: { opt: LangOption; selected: LangOption; onSelect: (o: LangOption) => void }) {
  const active = opt.code === selected.code;
  return (
    <button
      type="button"
      onClick={() => onSelect(opt)}
      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
      style={active ? { backgroundColor: "color-mix(in srgb, var(--primary) 8%, transparent)" } : undefined}
    >
      <span className={active ? "font-medium text-primary" : "text-foreground"}>{opt.label}</span>
      {active && <Check className="h-3.5 w-3.5 text-primary" />}
    </button>
  );
}
