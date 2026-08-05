"use client";

// Hand-rolled horizontal bar chart — single categorical hue (magnitude, not
// identity), thin rounded bars, direct value labels, recessive track.
import React, { useState } from "react";

export interface BarDatum {
  label: string;
  value: number;
}

export default function BarChart({ data, color = "var(--viz-1)" }: { data: BarDatum[]; color?: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div
          key={d.label}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          className="group"
        >
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="truncate text-foreground">{d.label}</span>
            <span className="tabular-nums text-muted-foreground">{d.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-border/60">
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{
                width: `${(d.value / max) * 100}%`,
                background: color,
                opacity: hovered === null || hovered === i ? 1 : 0.45,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
