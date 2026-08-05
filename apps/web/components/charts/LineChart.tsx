"use client";

// Hand-rolled SVG multi-series line chart — thin 2px lines (fixed categorical
// hue order from --viz-1..8, never reassigned), a legend, recessive grid, and
// a shared hover crosshair + tooltip showing every series' value at that
// x-position. No area fill under multiple series (overlapping fills obscure
// the lower series) — see the dataviz skill's anti-patterns note.
import React, { useState } from "react";

export interface LineSeries {
  label: string;
  values: number[];
}

const VIZ_COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)", "var(--viz-7)", "var(--viz-8)"];

export default function LineChart({
  labels,
  series,
  height = 220,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 640;
  const padTop = 12;
  const padBottom = 28;
  const padLeft = 8;
  const padRight = 8;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const allValues = series.flatMap((s) => s.values);
  const max = Math.max(1, ...allValues);
  const n = labels.length;

  const xAt = (i: number) => padLeft + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yAt = (v: number) => padTop + plotH - (v / max) * plotH;

  const pathFor = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(v)}`).join(" ");

  const gridLines = 4;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Line chart: ${series.map((s) => s.label).join(", ")} over ${labels.join(", ")}`}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* recessive horizontal grid */}
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const y = padTop + (plotH / gridLines) * i;
          return <line key={i} x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} opacity={0.6} />;
        })}

        {/* series lines */}
        {series.map((s, si) => (
          <path key={s.label} d={pathFor(s.values)} fill="none" stroke={VIZ_COLORS[si % VIZ_COLORS.length]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ))}

        {/* hover crosshair + points */}
        {hoverIndex != null && (
          <line x1={xAt(hoverIndex)} x2={xAt(hoverIndex)} y1={padTop} y2={padTop + plotH} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" />
        )}
        {series.map((s, si) =>
          s.values.map((v, i) => (
            <circle
              key={`${s.label}-${i}`}
              cx={xAt(i)}
              cy={yAt(v)}
              r={hoverIndex === i ? 4 : 2.5}
              fill={VIZ_COLORS[si % VIZ_COLORS.length]}
              stroke="var(--card)"
              strokeWidth={1.5}
            />
          ))
        )}

        {/* hover hit targets */}
        {labels.map((_, i) => (
          <rect
            key={i}
            x={xAt(i) - plotW / n / 2}
            y={padTop}
            width={plotW / n}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHoverIndex(i)}
            style={{ cursor: "pointer" }}
          />
        ))}

        {/* x-axis labels */}
        {labels.map((l, i) => (
          <text key={l} x={xAt(i)} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
            {l}
          </text>
        ))}
      </svg>

      {/* legend + hover readout */}
      <div className="mt-2 flex flex-wrap items-center gap-4">
        {series.map((s, si) => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: VIZ_COLORS[si % VIZ_COLORS.length] }} />
            <span className="text-foreground">{s.label}</span>
            {hoverIndex != null && <span className="tabular-nums text-muted-foreground">— {s.values[hoverIndex]}</span>}
          </div>
        ))}
        {hoverIndex != null && <span className="ml-auto text-xs text-muted-foreground">{labels[hoverIndex]}</span>}
      </div>
    </div>
  );
}
