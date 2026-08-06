import React from "react";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";

export interface Insight {
  title: string;
  detail: string;
  tone: "info" | "pending" | "rejected" | "approved";
  href?: string;
}

const TONE_VAR: Record<Insight["tone"], string> = {
  info: "--zira-info",
  pending: "--zira-pending",
  rejected: "--zira-rejected",
  approved: "--zira-approved",
};

// Rule-based, computed from the same numbers already on this page — not a
// model prediction, so no fabricated confidence score (the reference shows
// one; we don't claim ML we don't have). Framed as what it is: a short list
// of things worth a look right now.
export default function AIInsightsPanel({ insights }: { insights: Insight[] }) {
  return (
    <div className="card-elevated p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Insights
        </div>
        {insights.length > 0 && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}>
            {insights.length} today
          </span>
        )}
      </div>

      {insights.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Nothing needs attention right now.</p>
      ) : (
        <div className="space-y-2.5">
          {insights.map((ins, i) => {
            const body = (
              <div
                className="rounded-md py-2.5 pl-3 pr-2.5"
                style={{ borderLeft: `3px solid var(${TONE_VAR[ins.tone]})`, backgroundColor: "var(--muted)" }}
              >
                <p className="text-sm font-medium leading-snug">{ins.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{ins.detail}</p>
              </div>
            );
            return ins.href ? (
              <Link key={i} href={ins.href} className="group block transition-opacity hover:opacity-80">
                {body}
              </Link>
            ) : (
              <div key={i}>{body}</div>
            );
          })}
        </div>
      )}

      <Link href="/ai-insights" className="mt-3 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        Open full explanation <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
