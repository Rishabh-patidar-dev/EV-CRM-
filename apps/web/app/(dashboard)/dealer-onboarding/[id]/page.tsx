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
  ArrowLeft, Building2, FileCheck2, Loader2, ChevronRight, Mail, Phone, MapPin, Landmark, Eye, PauseCircle, XCircle, ScanText, CheckCircle2, RefreshCw,
} from "lucide-react";
import apiClient from "@/lib/api/client";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Documents can come from two upload paths with two different fileUrl
// shapes: the dealer portal (/dashboard) stores a path relative to this
// CRM's own API (e.g. /uploads/dealer-applications/...); the no-login
// /apply wizard stores a full URL back to the landing app's own storage
// (e.g. http://localhost:3001/api/apply/upload?path=...) since that's
// where the bytes actually live. Resolve the relative case against the
// CRM API origin; leave absolute URLs alone.
function resolveFileUrl(fileUrl: string): string {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${apiBase}${fileUrl}`;
}

const STAGE_META: Record<string, { short: string; n: number }> = {
  APPLICATION: { short: "Application", n: 1 },
  SCREENING_NDA: { short: "Screening & NDA", n: 2 },
  BUSINESS_PROPOSAL: { short: "Business Proposal", n: 3 },
  DUE_DILIGENCE: { short: "Due Diligence", n: 4 },
  LEGAL_AGREEMENT: { short: "Legal Agreement (LOI)", n: 5 },
  OPERATIONAL: { short: "Operational", n: 6 },
};

const STAGE_ORDER = Object.keys(STAGE_META);

const STATUS_TONE: Record<string, BadgeTone> = {
  IN_PROGRESS: "neutral",
  ON_HOLD: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  WITHDRAWN: "neutral",
};

const DOC_STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: "neutral",
  UPLOADED: "info",
  VERIFIED: "approved",
  REJECTED: "rejected",
};

export default function ApplicationDetailPage() {
  const params = useParams();
  const id = Number(params.id);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [appAction, setAppAction] = useState<"hold" | "reject" | null>(null);
  const [appReason, setAppReason] = useState("");
  const [appActionError, setAppActionError] = useState<string | null>(null);
  const [docRejectId, setDocRejectId] = useState<number | null>(null);
  const [docReason, setDocReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.get(`/api/v1/onboarding/applications/${id}`);
      setData(res.data);
    } catch (error: any) {
      console.error("[ApplicationDetailPage] failed to load application:", error);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load this application. Try again.");
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

  const verifyDoc = async (docId: number, status: string, notes?: string) => {
    await apiClient.patch(`/api/v1/onboarding/documents/${docId}`, { status, ...(notes && { notes }) });
    await load();
  };

  const submitAppAction = async () => {
    if (!appAction || !appReason.trim()) return;
    setBusy(true);
    setAppActionError(null);
    try {
      await apiClient.post(`/api/v1/onboarding/applications/${id}/${appAction}`, { note: appReason.trim() });
      setAppAction(null);
      setAppReason("");
      await load();
    } catch (error: any) {
      console.error("[ApplicationDetailPage] failed to submit application action:", error);
      setAppActionError(error?.response?.data?.message || error?.message || "Could not submit — try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitDocReject = async () => {
    if (!docRejectId || !docReason.trim()) return;
    await verifyDoc(docRejectId, "REJECTED", docReason.trim());
    setDocRejectId(null);
    setDocReason("");
  };

  // Bulk shortcut for the current stage: approve every uploaded document at
  // once and move straight to the next stage, instead of clicking Approve
  // on each document then Advance separately. Only ever called when every
  // document is already uploaded (button is disabled otherwise).
  const approveStage = async (docs: any[]) => {
    setBusy(true);
    try {
      await Promise.all(
        docs.filter((d: any) => d.status !== "VERIFIED").map((d: any) =>
          apiClient.patch(`/api/v1/onboarding/documents/${d.id}`, { status: "VERIFIED" })
        )
      );
      await apiClient.post(`/api/v1/onboarding/applications/${id}/advance`, {});
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.message ?? "Could not approve this stage.");
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-[color:var(--zira-rejected)]">{loadError}</p>
        <Button size="sm" variant="secondary" onClick={() => load()}>
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

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
      <Card className="mb-6 flex flex-wrap items-start justify-between gap-4">
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
            <Badge label={STAGE_META[data.stage]?.short ?? data.stage} tone="info" />
            <Badge status={data.status} tone={STATUS_TONE[data.status] ?? "neutral"} />
            {data.utmSource && <Badge label={`via ${data.utmSource}`} tone="neutral" />}
          </div>
          {(data.status === "ON_HOLD" || data.status === "REJECTED") && data.rejectionReason && (
            <p className="mt-3 max-w-lg rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {data.status === "REJECTED" ? "Rejection reason: " : "Hold reason: "}{data.rejectionReason}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={busy || data.status === "APPROVED" || data.status === "REJECTED" || data.status === "WITHDRAWN"}
              onClick={() => { setAppAction(appAction === "hold" ? null : "hold"); setAppActionError(null); }}
            >
              <PauseCircle className="h-4 w-4" /> Put on hold
            </Button>
            <Button
              variant="destructive"
              disabled={busy || data.status === "APPROVED" || data.status === "REJECTED" || data.status === "WITHDRAWN"}
              onClick={() => { setAppAction(appAction === "reject" ? null : "reject"); setAppActionError(null); }}
            >
              <XCircle className="h-4 w-4" /> Reject application
            </Button>
            <Button disabled={busy || data.status === "APPROVED" || data.status === "REJECTED"} onClick={advance}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
              Advance to next stage
            </Button>
          </div>
          {appAction && (
            <div className="w-80 rounded-[var(--radius)] border border-border bg-card p-3">
              <textarea
                autoFocus
                value={appReason}
                onChange={(e) => setAppReason(e.target.value)}
                placeholder={`Reason for ${appAction === "hold" ? "putting this on hold" : "rejecting this application"}…`}
                rows={2}
                className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
              {appActionError && (
                <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{appActionError}</p>
              )}
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setAppAction(null); setAppReason(""); setAppActionError(null); }}>Cancel</Button>
                <Button size="sm" disabled={busy || !appReason.trim()} onClick={submitAppAction}>Confirm</Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Documents, then Timeline below — always stacked, never a side-by-side
          split (a split layout here made the sparse Timeline card look
          broken next to the much taller document grid, and reads worse on
          anything narrower than a very wide monitor). */}
      <div className="space-y-5">
          {docsByStage.map(({ stage, docs }) => (
            <Card key={stage} className={stage === data.stage ? "border-primary" : ""}>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FileCheck2 className="h-4 w-4" /> Stage {STAGE_META[stage]?.n} · {STAGE_META[stage]?.short}
                {stage === data.stage && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">Current</span>}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {docs.map((d: any) => (
                  <div key={d.id} className="rounded-md border border-border p-3">
                    <div className="space-y-1.5">
                      <span className="block text-sm">
                        {d.label}
                        {d.required && <span className="ml-1 text-[color:var(--zira-rejected)]">*</span>}
                      </span>
                      <Badge status={d.status} tone={DOC_STATUS_TONE[d.status] ?? "neutral"} />
                    </div>
                    {d.status === "REJECTED" && d.notes && (
                      <p className="mt-1.5 text-xs text-[color:var(--zira-rejected)]">{d.notes}</p>
                    )}
                    {d.fileUrl && (
                      <a
                        href={resolveFileUrl(d.fileUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <Eye className="h-3 w-3" /> View document
                      </a>
                    )}
                    {d.ocrExtractedText && <DocOcrPreview text={d.ocrExtractedText} />}
                    {d.status !== "VERIFIED" && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => verifyDoc(d.id, "VERIFIED")}>
                          Approve
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setDocRejectId(docRejectId === d.id ? null : d.id)}>
                          Reject
                        </Button>
                      </div>
                    )}
                    {docRejectId === d.id && (
                      <div className="mt-2 rounded-md border border-border bg-muted/30 p-2">
                        <textarea
                          autoFocus
                          value={docReason}
                          onChange={(e) => setDocReason(e.target.value)}
                          placeholder="Reason for rejecting this document…"
                          rows={2}
                          className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                        />
                        <div className="mt-1.5 flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => { setDocRejectId(null); setDocReason(""); }}>Cancel</Button>
                          <Button size="sm" disabled={!docReason.trim()} onClick={submitDocReject}>Confirm reject</Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {stage === data.stage && (
                <div className="mt-4 border-t border-border pt-4">
                  <Button
                    className="w-full"
                    disabled={busy || docs.some((d: any) => d.status === "PENDING") || data.status === "APPROVED" || data.status === "REJECTED"}
                    onClick={() => approveStage(docs)}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Approve stage &amp; advance
                  </Button>
                  {docs.some((d: any) => d.status === "PENDING") && (
                    <p className="mt-1.5 text-center text-xs text-muted-foreground">
                      Waiting on {docs.filter((d: any) => d.status === "PENDING").length} document{docs.filter((d: any) => d.status === "PENDING").length === 1 ? "" : "s"} to be uploaded.
                    </p>
                  )}
                </div>
              )}
            </Card>
          ))}
          {docsByStage.length === 0 && (
            <div className="rounded-[var(--radius)] border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No documents seeded for this application yet.
            </div>
          )}

          <div className="card-elevated p-5">
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
          </div>
      </div>
    </div>
  );
}

function DocOcrPreview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
        <ScanText className="h-3 w-3" /> {open ? "Hide" : "Show"} extracted text
      </button>
      {open && <p className="mt-1.5 max-h-24 overflow-y-auto rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">{text}</p>}
    </div>
  );
}
