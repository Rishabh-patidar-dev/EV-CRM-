import React from "react";

// KPI tile with an icon badge and an optional trend line — the dashboard-grid
// card style (icon top-right, value, small colored trend underneath).
// `tone` varies the icon badge color per card (reference mock: each stat
// gets its own pastel-bg/solid-icon pair, not one repeated tint) — purely
// decorative identity, no semantic meaning attached to a given tone.
const TONES = {
  teal: { bg: "var(--accent)", fg: "var(--accent-foreground)" },
  blue: { bg: "#e6f0fd", fg: "#2a6fdb" },
  purple: { bg: "#f1ecfd", fg: "#6d4aed" },
  green: { bg: "#e6f7ee", fg: "#1f9d55" },
  amber: { bg: "#fff4dd", fg: "#b9790a" },
  red: { bg: "#fdeceb", fg: "#c23b30" },
} as const;

export function StatCard({
  icon,
  label,
  value,
  trend,
  trendDirection = "up",
  tone = "teal",
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  trend?: string;
  trendDirection?: "up" | "down";
  tone?: keyof typeof TONES;
}) {
  const t = TONES[tone];
  return (
    <div className="card-elevated p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        {icon && (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: t.bg, color: t.fg }}>
            {icon}
          </div>
        )}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {trend && (
        <div className={`mt-1 flex items-center gap-1 text-xs font-medium ${trendDirection === "up" ? "trend-up" : "trend-down"}`}>
          <span>{trendDirection === "up" ? "▲" : "▼"}</span>
          <span>{trend}</span>
        </div>
      )}
    </div>
  );
}

// Colored-left-border variant — for a small row of "hero stats" under a page
// intro (e.g. OCR accuracy / turnaround / query input on the reference login
// page), not a dashboard grid. Defaults to the warm gold accent — that's the
// reference's actual bar color on these cards, not the app's teal primary.
export function AccentStat({ label, value, colorVar = "--accent-warm" }: { label: string; value: React.ReactNode; colorVar?: string }) {
  return (
    <div className="card-elevated py-3 pl-4 pr-5" style={{ borderLeft: `3px solid var(${colorVar})` }}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}
