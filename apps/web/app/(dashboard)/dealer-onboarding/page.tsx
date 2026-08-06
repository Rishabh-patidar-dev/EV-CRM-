"use client";

// =============================================================================
//  Dealer Onboarding — pipeline monitoring board  (Module 3)
//  Copied from /web/app/dealer-onboarding/page.tsx with no changes — it's
//  self-contained via the shared apiClient and Zira theme tokens.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api/client";
import {
  Building2,
  ChevronRight,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
} from "lucide-react";
import CreateDealerModal from "@/components/orders/CreateDealerModal";

// ---- Stage metadata (labels mirror the 8-stage onboarding pipeline) ----------
const STAGE_META: Record<string, { short: string; n: number }> = {
  APPLICATION: { short: "Application", n: 1 },
  SCREENING_NDA: { short: "Screening & NDA", n: 2 },
  BUSINESS_PROPOSAL: { short: "Business Proposal", n: 3 },
  DUE_DILIGENCE: { short: "Due Diligence", n: 4 },
  LEGAL_AGREEMENT: { short: "Legal Agreement (LOI)", n: 5 },
  OPERATIONAL: { short: "Operational", n: 6 },
};

type Application = {
  id: number;
  publicId: string;
  legalName: string;
  tradeName?: string | null;
  contactName?: string | null;
  email: string;
  city?: string | null;
  state?: string | null;
  stage: string;
  status: string;
  tier?: string | null;
  updatedAt: string;
  utmSource?: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  IN_PROGRESS: "bg-secondary text-secondary-foreground",
  ON_HOLD: "bg-[color:var(--zira-pending)]/15 text-[color:var(--zira-pending)]",
  APPROVED: "bg-[color:var(--zira-approved)]/15 text-[color:var(--zira-approved)]",
  REJECTED: "bg-[color:var(--zira-rejected)]/15 text-[color:var(--zira-rejected)]",
  WITHDRAWN: "bg-muted text-muted-foreground",
};

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label.replaceAll("_", " ")}
    </span>
  );
}

export default function DealerOnboardingPage() {
  const router = useRouter();
  const [board, setBoard] = useState<{ stages: string[]; counts: Record<string, number> } | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadBoard = useCallback(async () => {
    const { data } = await apiClient.get("/api/v1/onboarding/board");
    setBoard(data);
  }, []);

  const loadApps = useCallback(async (stage: string | null) => {
    setLoading(true);
    try {
      const { data } = await apiClient.get("/api/v1/onboarding/applications", {
        params: { limit: 50, ...(stage ? { stage } : {}) },
      });
      setApps(data.applications ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBoard();
    loadApps(null);
  }, [loadBoard, loadApps]);

  const refresh = useCallback(async () => {
    await Promise.all([loadBoard(), loadApps(activeStage)]);
  }, [loadBoard, loadApps, activeStage]);

  const stageList = board?.stages ?? Object.keys(STAGE_META);
  const total = useMemo(
    () => Object.values(board?.counts ?? {}).reduce((a, b) => a + b, 0),
    [board]
  );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">Dealer Onboarding</h1>
          <p className="text-sm text-muted-foreground">
            {total} active application{total === 1 ? "" : "s"} across the pipeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Create dealer
          </button>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </header>

      <CreateDealerModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={refresh} />

      {/* Stage pipeline strip */}
      <div className="flex gap-3 overflow-x-auto border-b border-border px-6 py-4">
        {stageList
          .filter((s) => s !== "OPERATIONAL")
          .map((s, i, arr) => {
            const meta = STAGE_META[s];
            const count = board?.counts?.[s] ?? 0;
            const isActive = activeStage === s;
            return (
              <React.Fragment key={s}>
                <button
                  onClick={() => {
                    const next = isActive ? null : s;
                    setActiveStage(next);
                    loadApps(next);
                  }}
                  className={`min-w-[9rem] shrink-0 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    isActive
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-accent"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Stage {meta?.n}
                    </span>
                    <span className="text-lg font-semibold tabular-nums">{count}</span>
                  </div>
                  <div className="mt-0.5 text-sm font-medium">{meta?.short}</div>
                </button>
                {i < arr.length - 1 && (
                  <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground/50" />
                )}
              </React.Fragment>
            );
          })}
      </div>

      {/* List — full width; clicking a row opens its own detail page */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading applications…
          </div>
        ) : apps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
            No applications{activeStage ? ` in ${STAGE_META[activeStage]?.short}` : ""} yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {apps.map((a) => (
              <button
                key={a.id}
                onClick={() => router.push(`/dealer-onboarding/${a.id}`)}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{a.legalName}</span>
                    {a.tradeName && (
                      <span className="truncate text-sm text-muted-foreground">· {a.tradeName}</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    {a.contactName && <span>{a.contactName}</span>}
                    <span className="font-mono">{a.publicId.slice(0, 10)}</span>
                    {(a.city || a.state) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {[a.city, a.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                    {a.utmSource && <span>via {a.utmSource}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge label={STAGE_META[a.stage]?.short ?? a.stage} className="bg-secondary text-secondary-foreground" />
                  <Badge label={a.status} className={STATUS_STYLES[a.status] ?? "bg-muted"} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
