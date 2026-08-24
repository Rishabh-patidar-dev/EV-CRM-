"use client";

// ============================================================================
// Lead detail (full page)
// ============================================================================
// Route: /leads/[id]
// Was a 400px side panel on the leads list page; moved to its own full-width
// page so the score breakdown, status/owner controls and the remarks/activity
// trail can sit side by side instead of stacked in a narrow column.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Users, Building2, MessageSquarePlus, Mail, Phone, RefreshCw } from "lucide-react";
import apiClient from "@/lib/api/client";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type LeadStatus = "OPEN" | "WORKING" | "QUALIFIED" | "UNQUALIFIED" | "NURTURING" | "CONVERTED";

interface UserOption { id: number; firstName: string; lastName?: string | null }

const LEAD_STATUS_TONE: Record<LeadStatus, BadgeTone> = {
  OPEN: "neutral",
  WORKING: "neutral",
  QUALIFIED: "approved",
  UNQUALIFIED: "rejected",
  NURTURING: "pending",
  CONVERTED: "approved",
};

const STATUS_OPTIONS: LeadStatus[] = ["OPEN", "WORKING", "QUALIFIED", "UNQUALIFIED", "NURTURING", "CONVERTED"];

function displayName(p: { firstName: string; lastName?: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ");
}

export default function LeadDetailPage() {
  const params = useParams();
  const leadId = Number(params.id);

  const [data, setData] = useState<any | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remarkText, setRemarkText] = useState("");
  const [converting, setConverting] = useState(false);

  const load = useCallback(async () => {
    const res = await apiClient.get(`/api/v1/leads/${leadId}`);
    setData(res.data);
  }, [leadId]);

  const loadAll = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    return Promise.all([
      apiClient
        .get(`/api/v1/leads/${leadId}`)
        .then((r) => setData(r.data))
        .catch((error: any) => {
          console.error("[LeadDetailPage] failed to load lead:", error);
          setLoadError(error?.response?.data?.message || error?.message || "Could not load this lead. Try refreshing.");
        }),
      apiClient.get("/api/v1/users").then((r) => setUsers(r.data.users ?? [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [leadId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const setStatus = async (status: LeadStatus) => {
    setError(null);
    try {
      await apiClient.patch(`/api/v1/leads/${leadId}`, { status });
      await load();
    } catch (error: any) {
      console.error("[LeadDetailPage] failed to update lead status:", error);
      setError(error?.response?.data?.message || error?.message || "Could not update the lead status. Try again.");
    }
  };

  const assign = async (ownerId: string) => {
    await apiClient.put(`/api/v1/leads/${leadId}/assign`, { ownerId: ownerId || null });
    await load();
  };

  const addRemark = async () => {
    if (!remarkText.trim()) return;
    await apiClient.post(`/api/v1/leads/${leadId}/remarks`, { remark: remarkText.trim() });
    setRemarkText("");
    await load();
  };

  const convertToDealer = async () => {
    setConverting(true);
    try {
      await apiClient.post(`/api/v1/leads/${leadId}/convert-to-dealer`, {});
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.message ?? "Could not convert this lead to a dealer application");
    } finally {
      setConverting(false);
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-[1600px] p-6">
        <div className="rounded-[var(--radius)] border border-dashed border-[color:var(--zira-rejected)]/40 p-10 text-center text-[color:var(--zira-rejected)]">
          {loadError}
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={loadAll}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading lead…</div>;
  }

  return (
    <div className="mx-auto max-w-[1600px] p-6">
      <Link href="/leads" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Link>

      {/* Header */}
      <Card className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 shrink-0 text-primary" />
            <h1 className="truncate text-2xl font-semibold tracking-tight">{displayName(data)}</h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> {data.email}</span>
            {data.phone && <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {data.phone}</span>}
            {data.companyName && <span>{data.companyName}</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge status={data.status} tone={LEAD_STATUS_TONE[data.status as LeadStatus] ?? "neutral"} />
            <Badge label={data.source} tone="neutral" />
          </div>
        </div>

        {/* "dealer is the lead": every lead can turn out to be a potential
            dealer, not just a retail buyer — one click starts onboarding. */}
        <div className="shrink-0">
          {data.dealerApplication ? (
            <Link
              href={`/dealer-onboarding`}
              className="flex items-center gap-2 rounded-[var(--radius)] border border-primary/40 bg-accent px-4 py-2.5 text-sm font-medium text-primary hover:opacity-90"
            >
              <Building2 className="h-4 w-4" /> Dealer application {data.dealerApplication.publicId.slice(0, 8)} · {data.dealerApplication.stage.replace(/_/g, " ")}
            </Link>
          ) : (
            <Button variant="secondary" onClick={convertToDealer} disabled={converting}>
              <Building2 className="h-4 w-4" /> {converting ? "Converting…" : "This lead is a potential dealer — start onboarding"}
            </Button>
          )}
        </div>
      </Card>

      {/* Score/status/owner, then remarks/activity below — always stacked,
          never a side-by-side split. */}
      <div className="space-y-5">
          <Card>
            <SectionTitle>Score</SectionTitle>
            <div className="mt-3 grid grid-cols-3 gap-3 max-w-md">
              <ScoreCell label="Total" value={data.score} />
              <ScoreCell label="Completeness" value={data.completenessScore} />
              <ScoreCell label="Quality" value={data.qualityScore} />
            </div>
            {Array.isArray(data.missingFields) && data.missingFields.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Missing: {data.missingFields.join(", ")}</p>
            )}
          </Card>

          <Card>
            <SectionTitle>Status</SectionTitle>
            {error && (
              <p className="mt-2 text-sm text-[color:var(--zira-rejected)]">{error}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`rounded border px-2.5 py-1.5 text-xs ${data.status === s ? "border-primary text-primary" : "border-border hover:bg-accent"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle>Owner</SectionTitle>
            <select
              value={data.owner?.id ?? ""}
              onChange={(e) => assign(e.target.value)}
              className="mt-3 w-full max-w-sm rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{displayName(u)}</option>)}
            </select>
          </Card>

          {data.dealerAssignment && (
            <Card>
              <SectionTitle>Routed to dealer</SectionTitle>
              <p className="mt-2 text-sm">{data.dealerAssignment.dealer?.legalName} <span className="text-xs text-muted-foreground">({data.dealerAssignment.status})</span></p>
            </Card>
          )}

          <Card>
          <SectionTitle>Remarks</SectionTitle>
          <div className="mt-3 flex gap-2">
            <input
              value={remarkText}
              onChange={(e) => setRemarkText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRemark()}
              placeholder="Log a call, note, next step…"
              className="flex-1 rounded-[var(--radius)] border border-border bg-background px-3 py-1.5 text-sm"
            />
            <button onClick={addRemark} className="rounded-[var(--radius)] border border-border p-1.5 hover:bg-accent" title="Add remark">
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          </div>
          <ul className="mt-4 space-y-3">
            {(data.remarks ?? []).map((r: any) => (
              <li key={r.id} className="text-xs">
                <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()} · {displayName(r.user)}</span>
                <p className="mt-0.5 text-foreground">{r.remark}</p>
              </li>
            ))}
            {(data.remarks ?? []).length === 0 && <li className="text-xs text-muted-foreground">No remarks yet — every status change and note is logged here.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</div>;
}

function ScoreCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius)] border border-border p-3">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
