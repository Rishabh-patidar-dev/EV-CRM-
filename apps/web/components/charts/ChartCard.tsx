import React from "react";

// Structured chart header — title + optional context line + an optional
// trend pill (e.g. "+18.4% vs prior period") — so every chart reads the
// same way: what this is, over what period, and which direction it moved.
export default function ChartCard({
  title,
  subtitle,
  trend,
  trendDirection = "up",
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  trend?: string;
  trendDirection?: "up" | "down";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`card-elevated p-4 ${className}`}>
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
        {trend && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${trendDirection === "up" ? "trend-up bg-[color:var(--zira-approved)]/10" : "trend-down bg-[color:var(--zira-rejected)]/10"}`}>
            {trendDirection === "up" ? "▲" : "▼"} {trend}
          </span>
        )}
      </div>
      {subtitle && <div className="mb-3 text-[11px] text-muted-foreground">{subtitle}</div>}
      {!subtitle && <div className="mb-2" />}
      {children}
    </div>
  );
}
