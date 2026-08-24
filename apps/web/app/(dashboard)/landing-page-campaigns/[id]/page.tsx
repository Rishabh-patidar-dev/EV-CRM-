"use client";

// ============================================================================
// Landing page campaign detail (full page)
// ============================================================================
// Route: /landing-page-campaigns/[id]
// Was a 420px side panel on the campaigns list page; moved to its own
// full-width page so the webhook contract, GTM setup, and the full lists of
// attributed enquiries/applications can sit side by side instead of stacked
// in a narrow column.
// ============================================================================
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Megaphone, Copy, Check, Loader2 } from "lucide-react";
import apiClient from "@/lib/api/client";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

type CampaignStatus = "ACTIVE" | "PAUSED" | "SCHEDULED" | "CLOSED" | "ARCHIVED";

const STATUS_TONE: Record<CampaignStatus, BadgeTone> = {
  ACTIVE: "approved",
  PAUSED: "pending",
  SCHEDULED: "info",
  CLOSED: "neutral",
  ARCHIVED: "neutral",
};

export default function CampaignDetailPage() {
  const params = useParams();
  const id = Number(params.id);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiClient.get(`/api/v1/landing-page-campaigns/${id}`)
      .then((res) => { if (active) setData(res.data); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  const copyId = () => {
    if (!data) return;
    navigator.clipboard?.writeText(data.uniqueId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading campaign…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] p-6">
      <Link href="/landing-page-campaigns" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to campaigns
      </Link>

      {/* Header */}
      <Card className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 shrink-0 text-primary" />
            <h1 className="truncate text-2xl font-semibold tracking-tight">{data.name}</h1>
          </div>
          {data.description && <p className="mt-1 text-sm text-muted-foreground">{data.description}</p>}
          <div className="mt-3">
            <Badge status={data.status} tone={STATUS_TONE[data.status as CampaignStatus] ?? "neutral"} />
          </div>
        </div>
      </Card>

      {/* Body: webhook + GTM contract (wide) + attributed leads (narrow), both fully expanded */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <Card>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Unique ID (webhook contract)</div>
            <div className="mt-2 flex items-center gap-2">
              <code className="block flex-1 break-all rounded bg-muted px-3 py-2 text-xs">{data.uniqueId}</code>
              <button onClick={copyId} className="shrink-0 rounded border border-border p-2 hover:bg-accent" title="Copy unique ID">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Sent as <code>landing_page_campaign_id</code> in <code>POST /api/v1/ingest/landing-page</code>.
            </p>
          </Card>

          <Card>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">GTM container</div>
            {data.gtmContainerId ? (
              <code className="mt-2 block break-all rounded bg-muted px-3 py-2 text-xs">{data.gtmContainerId}</code>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Not set — the landing page falls back to its own default container.</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Loaded from <code>GET /api/v1/landing-page-campaigns/unique/:uniqueId</code>. On a successful submission
              the landing page should push <code>{"{event:'ev_vikas_submission', intent, campaign_id}"}</code> to
              <code> window.dataLayer</code> so GTM can fire the conversion tag.
            </p>
          </Card>

          <Card>
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent dealer applications</div>
            <ul className="space-y-2">
              {(data.applications ?? []).map((a: any) => (
                <li key={a.id} className="flex items-center justify-between rounded-md border border-border p-2.5 text-sm">
                  <span>{a.legalName}</span>
                  <span className="text-xs text-muted-foreground">{a.stage}</span>
                </li>
              ))}
              {(data.applications ?? []).length === 0 && <li className="text-xs text-muted-foreground">No dealer applications yet.</li>}
            </ul>
          </Card>
        </div>

        <aside className="card-elevated p-5">
          <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent enquiries</div>
          <ul className="space-y-2">
            {(data.enquiries ?? []).map((e: any) => (
              <li key={e.id} className="flex items-center justify-between text-sm">
                <span>{e.lead?.firstName} {e.lead?.lastName ?? ""}</span>
                <span className="text-xs text-muted-foreground">{e.status}</span>
              </li>
            ))}
            {(data.enquiries ?? []).length === 0 && <li className="text-xs text-muted-foreground">No enquiries yet.</li>}
          </ul>
        </aside>
      </div>
    </div>
  );
}
