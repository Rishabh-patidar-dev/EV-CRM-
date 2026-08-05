import React from "react";

// KPI tile with an icon badge and an optional trend line — the dashboard-grid
// card style (icon top-right, value, small colored trend underneath).
export function StatCard({
  icon,
  label,
  value,
  trend,
  trendDirection = "up",
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  trend?: string;
  trendDirection?: "up" | "down";
}) {
  return (
    <div className="card-elevated p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        {icon && (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
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
// page), not a dashboard grid.
export function AccentStat({ label, value, colorVar = "--primary" }: { label: string; value: React.ReactNode; colorVar?: string }) {
  return (
    <div className="card-elevated py-3 pl-4 pr-5" style={{ borderLeft: `3px solid var(${colorVar})` }}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}
