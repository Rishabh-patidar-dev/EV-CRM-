"use client";

// ============================================================================
// Dealer Onboarding — application detail (full page)
// ============================================================================
// Route: /dealer-onboarding/[id]
// Was a 26rem side panel on the board page; moved to its own full-width page
// so the document checklist (every stage, not just the current one) and the
// stage timeline can sit side by side instead of stacked in a narrow column.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Building2, FileCheck2, Loader2, ChevronRight, Mail, Phone, MapPin, Landmark,
} from "lucide-react";
import apiClient from "@/lib/api/client";

const STAGE_META: Record<string, { short: string; n: number }> = {
  APPLICATION: { short: "Application", n: 1 },
  SCREENING_NDA: { short: "Screening & NDA", n: 2 },
  BUSINESS_PROPOSAL: { short: "Business Proposal", n: 3 },
  DUE_DILIGENCE: { short: "Due Diligence", n: 4 },
  LEGAL_AGREEMENT: { short: "Legal Agreement (LOI)", n: 5 },
  OPERATIONAL: { short: "Operational", n: 6 },
};

const STAGE_ORDER = Object.keys(STAGE_META);

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
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {label.replaceAll("_", " ")}
    </span>
  );
}

export default function ApplicationDetailPage() {
  const params = useParams();
  const id = Number(params.id);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/api/v1/onboarding/applications/${id}`);
      setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const advance = async () => {
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/onboarding/applications/${id}/advance`, {});
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.message ?? "Could not advance — verify required documents first.");
    } finally {
      setBusy(false);
    }
  };

  const verifyDoc = async (docId: number, status: string) => {
    await apiClient.patch(`/api/v1/onboarding/documents/${docId}`, { status });
    await load();
  };

  if (loading || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading application…
      </div>
    );
  }

  const docsByStage = STAGE_ORDER.filter((s) => s !== "OPERATIONAL").map((stage) => ({
    stage,
    docs: (data.documents ?? []).filter((d: any) => d.stage === stage),
  })).filter((g) => g.docs.length > 0);

  return (
    <div className="mx-auto max-w-[1600px] p-6">
      <Link href="/dealer-onboarding" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to onboarding pipeline
      </Link>

      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-[var(--radius)] border border-border bg-card p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 shrink-0 text-primary" />
            <h1 className="truncate text-2xl font-semibold tracking-tight">{data.legalName}</h1>
            {data.tradeName && <span className="truncate text-base text-muted-foreground">· {data.tradeName}</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> {data.email}</span>
            {data.phone && <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {data.phone}</span>}
            {(data.city || data.state) && (
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {[data.city, data.state].filter(Boolean).join(", ")}</span>
            )}
            {data.gstin && <span className="inline-flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5" /> GST {data.gstin}</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge label={STAGE_META[data.stage]?.short ?? data.stage} className="bg-primary/10 text-primary" />
            <Badge label={data.status} className={STATUS_STYLES[data.status] ?? "bg-muted"} />
            {data.utmSource && <Badge label={`via ${data.utmSource}`} className="bg-muted text-muted-foreground" />}
          </div>
        </div>

        <button
          disabled={busy || data.status === "APPROVED" || data.status === "REJECTED"}
          onClick={advance}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius)] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
          Advance to next stage
        </button>
      </header>

      {/* Body: documents (wide) + timeline (narrow), both fully expanded */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {docsByStage.map(({ stage, docs }) => (
            <div
              key={stage}
              className={`rounded-[var(--radius)] border bg-card p-5 ${stage === data.stage ? "border-primary" : "border-border"}`}
            >
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FileCheck2 className="h-4 w-4" /> Stage {STAGE_META[stage]?.n} · {STAGE_META[stage]?.short}
                {stage === data.stage && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">Current</span>}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {docs.map((d: any) => (
                  <div key={d.id} className="rounded-md border border-border p-3">
                    <div className="space-y-1.5">
                      <span className="block text-sm">
                        {d.label}
                        {d.required && <span className="ml-1 text-[color:var(--zira-rejected)]">*</span>}
                      </span>
                      <Badge label={d.status} className={DOC_STATUS_STYLES[d.status] ?? "bg-muted"} />
                    </div>
                    {d.status !== "VERIFIED" && (
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => verifyDoc(d.id, "VERIFIED")} className="rounded border border-border px-2 py-1 text-xs hover:bg-accent">
                          Mark verified
                        </button>
                        <button onClick={() => verifyDoc(d.id, "REJECTED")} className="rounded border border-border px-2 py-1 text-xs hover:bg-accent">
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {docsByStage.length === 0 && (
            <div className="rounded-[var(--radius)] border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No documents seeded for this application yet.
            </div>
          )}
        </div>

        <aside className="rounded-[var(--radius)] border border-border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold">Timeline</h3>
          <ol className="space-y-3">
            {(data.stageHistory ?? []).map((e: any) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div>
                  <div className="font-medium">
                    {e.fromStage ? `${STAGE_META[e.fromStage]?.short ?? e.fromStage} → ` : ""}
                    {STAGE_META[e.toStage]?.short ?? e.toStage}
                  </div>
                  {e.note && <div className="text-muted-foreground">{e.note}</div>}
                  <div className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</div>
                </div>
              </li>
            ))}
            {(data.stageHistory ?? []).length === 0 && <li className="text-xs text-muted-foreground">No stage transitions yet.</li>}
          </ol>
        </aside>
      </div>
    </div>
  );
}
