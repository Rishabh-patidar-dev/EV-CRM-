"use client";

// Hand-rolled SVG donut — no charting library. Follows the dataviz skill's
// mark spec: thin ring, 2px gaps between segments, a fixed categorical hue
// order (--viz-1..8, never reassigned per render), a legend (always present
// for 2+ series), and a hover tooltip. Colors come from CSS custom
// properties so light/dark both resolve through the theme, not a flip.
import React, { useState } from "react";

export interface DonutDatum {
  label: string;
  value: number;
}

const VIZ_COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)", "var(--viz-7)", "var(--viz-8)"];

export default function DonutChart({
  data,
  size = 168,
  thickness = 22,
  centerLabel,
}: {
  data: DonutDatum[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const nonZero = data.filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = 3; // px gap between segments, at the circumference scale

  let offset = 0;
  const segments = nonZero.map((d, i) => {
    const colorIndex = data.indexOf(d) % VIZ_COLORS.length;
    const length = total > 0 ? (d.value / total) * circumference : 0;
    const dash = Math.max(0, length - gap);
    const seg = { ...d, color: VIZ_COLORS[colorIndex], dashArray: `${dash} ${circumference - dash}`, dashOffset: -offset, index: data.indexOf(d) };
    offset += length;
    return seg;
  });

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Donut chart: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={thickness} opacity={total === 0 ? 1 : 0.35} />
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {segments.map((s) => (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={hovered === s.index ? thickness + 4 : thickness}
                strokeDasharray={s.dashArray}
                strokeDashoffset={s.dashOffset}
                strokeLinecap="round"
                style={{ transition: "stroke-width 120ms ease", cursor: "pointer" }}
                onMouseEnter={() => setHovered(s.index)}
                onMouseLeave={() => setHovered(null)}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {hovered != null && data[hovered] ? (
            <>
              <div className="text-lg font-semibold tabular-nums">{data[hovered].value}</div>
              <div className="max-w-[80px] truncate text-center text-[10px] text-muted-foreground">{data[hovered].label}</div>
            </>
          ) : (
            <>
              <div className="text-xl font-semibold tabular-nums">{total}</div>
              {centerLabel && <div className="text-[10px] text-muted-foreground">{centerLabel}</div>}
            </>
          )}
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => (
          <li
            key={d.label}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-xs transition-colors ${hovered === i ? "bg-accent" : ""}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: VIZ_COLORS[i % VIZ_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate text-foreground">{d.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
