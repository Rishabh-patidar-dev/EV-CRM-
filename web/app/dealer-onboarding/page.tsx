"use client";

// =============================================================================
//  Dealer Onboarding — pipeline monitoring board  (Module 3)
//  Place in: apps/web/app/dealer-onboarding/page.tsx
//
//  Self-contained: fetches through the existing `apiClient` axios instance
//  (JWT via cookie is added by its request interceptor). All colours come from
//  the Zira theme tokens, so it inherits the palette automatically. No heavy
//  libraries, no continuous animation — just fast, practical enterprise UI.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/api/client";
import {
  Building2,
  ChevronRight,
  FileCheck2,
  Loader2,
  MapPin,
  RefreshCw,
} from "lucide-react";

// ---- Stage metadata (labels mirror the 8-stage onboarding pipeline) ----------
const STAGE_META: Record<string, { short: string; n: number }> = {
  APPLICATION: { short: "Application", n: 1 },
  SCREENING_NDA: { short: "Screening & NDA", n: 2 },
  BUSINESS_PROPOSAL: { short: "Business Proposal", n: 3 },
  DUE_DILIGENCE: { short: "Due Diligence", n: 4 },
  LEGAL_AGREEMENT: { short: "Agreement & Deposit", n: 5 },
  FACILITY_BRANDING: { short: "Facility & Branding", n: 6 },
  STAFF_TRAINING: { short: "Training", n: 7 },
  GO_LIVE: { short: "Go-Live", n: 8 },
  OPERATIONAL: { short: "Operational", n: 9 },
};

type Application = {
  id: number;
  publicId: string;
  legalName: string;
  tradeName?: string | null;
  email: string;
  city?: string | null;
  state?: string | null;
  stage: string;
  status: string;
  tier?: string | null;
  updatedAt: string;
  utmSource?: string | null;
};

type ApplicationDetail = Application & {
  contactName: string;
  phone?: string | null;
  gstin?: string | null;
  documents: {
    id: number;
    stage: string;
    docKey: string;
    label: string;
    required: boolean;
    status: string;
  }[];
  stageHistory: { id: number; fromStage: string | null; toStage: string; note?: string | null; createdAt: string }[];
};

const STATUS_STYLES: Record<string, string> = {
  IN_PROGRESS: "bg-secondary text-secondary-foreground",
  ON_HOLD: "bg-[color:var(--zira-pending)]/15 text-[color:var(--zira-pending)]",
  APPROVED: "bg-[color:var(--zira-approved)]/15 text-[color:var(--zira-approved)]",
  REJECTED: "bg-[color:var(--zira-rejected)]/15 text-[color:var(--zira-rejected)]",
  WITHDRAWN: "bg-muted text-muted-foreground",
};

const DOC_STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  UPLOADED: "bg-[color:var(--zira-info)]/15 text-[color:var(--zira-info)]",
  VERIFIED: "bg-[color:var(--zira-approved)]/15 text-[color:var(--zira-approved)]",
  REJECTED: "bg-[color:var(--zira-rejected)]/15 text-[color:var(--zira-rejected)]",
};

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label.replaceAll("_", " ")}
    </span>
  );
}

export default function DealerOnboardingPage() {
  const [board, setBoard] = useState<{ stages: string[]; counts: Record<string, number> } | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [selected, setSelected] = useState<ApplicationDetail | null>(null);
  const [busy, setBusy] = useState(false);

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

  const openDetail = useCallback(async (id: number) => {
    const { data } = await apiClient.get(`/api/v1/onboarding/applications/${id}`);
    setSelected(data);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadBoard(), loadApps(activeStage)]);
    if (selected) await openDetail(selected.id);
  }, [loadBoard, loadApps, activeStage, selected, openDetail]);

  const advance = useCallback(
    async (id: number) => {
      setBusy(true);
      try {
        await apiClient.post(`/api/v1/onboarding/applications/${id}/advance`, {});
        await refresh();
      } catch (e: any) {
        alert(e?.response?.data?.message ?? "Could not advance — verify required documents first.");
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const verifyDoc = useCallback(
    async (docId: number, status: string) => {
      await apiClient.patch(`/api/v1/onboarding/documents/${docId}`, { status });
      if (selected) await openDetail(selected.id);
    },
    [selected, openDetail]
  );

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
        <button
          onClick={refresh}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

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

      {/* Body: list + detail */}
      <div className="flex min-h-0 flex-1">
        {/* List */}
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
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
                  onClick={() => openDetail(a.id)}
                  className={`flex items-center justify-between rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent ${
                    selected?.id === a.id ? "border-primary" : "border-border"
                  }`}
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
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <aside className="flex w-[26rem] shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
            <div className="border-b border-border p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{selected.legalName}</h2>
                  <p className="text-sm text-muted-foreground">{selected.contactName} · {selected.email}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">✕</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge label={STAGE_META[selected.stage]?.short ?? selected.stage} className="bg-primary/10 text-primary" />
                <Badge label={selected.status} className={STATUS_STYLES[selected.status] ?? "bg-muted"} />
                {selected.gstin && <Badge label={`GST ${selected.gstin}`} className="bg-muted text-muted-foreground" />}
              </div>
            </div>

            {/* Document checklist for current stage */}
            <div className="p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FileCheck2 className="h-4 w-4" /> Documents · {STAGE_META[selected.stage]?.short}
              </h3>
              <div className="space-y-2">
                {selected.documents
                  .filter((d) => d.stage === selected.stage)
                  .map((d) => (
                    <div key={d.id} className="rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm">
                          {d.label}
                          {d.required && <span className="ml-1 text-[color:var(--zira-rejected)]">*</span>}
                        </span>
                        <Badge label={d.status} className={DOC_STATUS_STYLES[d.status] ?? "bg-muted"} />
                      </div>
                      {d.status !== "VERIFIED" && (
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => verifyDoc(d.id, "VERIFIED")}
                            className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                          >
                            Mark verified
                          </button>
                          <button
                            onClick={() => verifyDoc(d.id, "REJECTED")}
                            className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>

              <button
                disabled={busy || selected.status === "APPROVED" || selected.status === "REJECTED"}
                onClick={() => advance(selected.id)}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                Advance to next stage
              </button>
              <p className="mt-2 text-xs text-muted-foreground">
                All required (*) documents must be verified before advancing.
              </p>
            </div>

            {/* Stage history */}
            <div className="border-t border-border p-5">
              <h3 className="mb-3 text-sm font-semibold">Timeline</h3>
              <ol className="space-y-3">
                {selected.stageHistory.map((e) => (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div>
                      <div className="font-medium">
                        {e.fromStage ? `${STAGE_META[e.fromStage]?.short ?? e.fromStage} → ` : ""}
                        {STAGE_META[e.toStage]?.short ?? e.toStage}
                      </div>
                      {e.note && <div className="text-muted-foreground">{e.note}</div>}
                      <div className="text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
