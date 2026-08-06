"use client";

// Hand-rolled SVG multi-series line chart — smoothed curves with a soft
// gradient area fill under each series (Innovun reference's "adoption
// trend" look), a floating dark tooltip bubble on hover instead of a
// static legend readout, fixed categorical hue order from --viz-1..8
// (never reassigned). Same data contract/props as before — this is a
// restyle, not a rebuild.
import React, { useId, useState } from "react";

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
  const gradId = useId();
  const width = 640;
  const padTop = 16;
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

  // Smoothed path via quadratic midpoint curves — reads as a soft trend
  // line instead of a jagged polyline, without pulling in a curve library.
  const smoothPathFor = (values: number[]) => {
    const pts = values.map((v, i) => [xAt(i), yAt(v)] as const);
    if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : "";
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const mx = (x0 + x1) / 2;
      d += ` Q ${x0} ${y0} ${mx} ${(y0 + y1) / 2}`;
    }
    const [lx, ly] = pts[pts.length - 1];
    d += ` T ${lx} ${ly}`;
    return d;
  };

  const areaPathFor = (values: number[]) => {
    const line = smoothPathFor(values);
    if (!line) return "";
    const lastX = xAt(values.length - 1);
    const firstX = xAt(0);
    return `${line} L ${lastX} ${padTop + plotH} L ${firstX} ${padTop + plotH} Z`;
  };

  const gridLines = 4;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Line chart: ${series.map((s) => s.label).join(", ")} over ${labels.join(", ")}`}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          {series.map((s, si) => (
            <linearGradient key={s.label} id={`${gradId}-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={VIZ_COLORS[si % VIZ_COLORS.length]} stopOpacity={0.28} />
              <stop offset="100%" stopColor={VIZ_COLORS[si % VIZ_COLORS.length]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {/* recessive horizontal grid */}
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const y = padTop + (plotH / gridLines) * i;
          return <line key={i} x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} opacity={0.6} />;
        })}

        {/* gradient area fills, back to front so the first series reads on top */}
        {series.map((s, si) => (
          <path key={`area-${s.label}`} d={areaPathFor(s.values)} fill={`url(#${gradId}-${si})`} stroke="none" />
        ))}

        {/* smoothed series lines */}
        {series.map((s, si) => (
          <path key={s.label} d={smoothPathFor(s.values)} fill="none" stroke={VIZ_COLORS[si % VIZ_COLORS.length]} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
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

      {/* floating dark tooltip bubble at the hovered point, above the topmost series */}
      {hoverIndex != null && series.length > 0 && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md px-2.5 py-1.5 text-[11px] font-medium shadow-lg"
          style={{
            left: `${(xAt(hoverIndex) / width) * 100}%`,
            top: `${(Math.min(...series.map((s) => yAt(s.values[hoverIndex!]))) / height) * 100}%`,
            backgroundColor: "var(--foreground)",
            color: "var(--background)",
            marginTop: "-8px",
            whiteSpace: "nowrap",
          }}
        >
          {series.reduce((sum, s) => sum + s.values[hoverIndex], 0).toLocaleString()} total &middot; {labels[hoverIndex]}
        </div>
      )}

      {/* legend */}
      <div className="mt-2 flex flex-wrap items-center gap-4">
        {series.map((s, si) => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: VIZ_COLORS[si % VIZ_COLORS.length] }} />
            <span className="text-foreground">{s.label}</span>
            {hoverIndex != null && <span className="tabular-nums text-muted-foreground">— {s.values[hoverIndex]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
