import React from "react";

export interface TargetBarDatum {
  label: string;
  value: number; // 0-100+ (percent attainment already computed by the caller)
  statusLabel: string;
}

// Attainment-vs-target bar: the track represents 0-`scaleMax`% so a bar can
// visibly overshoot the dashed 100% target marker instead of just capping at
// the track's own edge. Colored by how close to target (>=100 green, >=85
// amber, else red) — status is encoded in both color and text, never color
// alone.
export default function TargetBarChart({ data, scaleMax = 130 }: { data: TargetBarDatum[]; scaleMax?: number }) {
  const targetPct = (100 / scaleMax) * 100;
  return (
    <div className="space-y-3">
      {data.map((d) => {
        const fillPct = Math.min(100, (d.value / scaleMax) * 100);
        const color = d.value >= 100 ? "var(--zira-approved)" : d.value >= 85 ? "var(--zira-pending)" : "var(--zira-rejected)";
        return (
          <div key={d.label} className="flex items-center gap-3 text-sm">
            <span className="w-20 shrink-0 truncate font-medium">{d.label}</span>
            <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${fillPct}%`, background: color }} />
              <div className="absolute inset-y-[-2px] w-px border-l border-dashed" style={{ left: `${targetPct}%`, borderColor: "var(--muted-foreground)" }} />
            </div>
            <span className="w-12 shrink-0 text-right tabular-nums text-xs font-semibold" style={{ color }}>{d.value}%</span>
            <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{d.statusLabel}</span>
          </div>
        );
      })}
    </div>
  );
}
