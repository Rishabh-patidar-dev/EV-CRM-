"use client";

// ============================================================================
// LANDING PAGE CAMPAIGNS — ported from innocrm-staging, simplified
// ============================================================================
// Route: /landing-page-campaigns
// Each campaign's `uniqueId` is the one thing the external landing page
// needs from us: pass it back as `landing_page_campaign_id` in the webhook
// payload and every enquiry/application it produces is attributed here.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Copy, Check, ExternalLink } from "lucide-react";
import apiClient from "@/lib/api/client";

type CampaignStatus = "ACTIVE" | "PAUSED" | "SCHEDULED" | "CLOSED" | "ARCHIVED";

interface Campaign {
  id: number;
  name: string;
  description?: string | null;
  uniqueId: string;
  status: CampaignStatus;
  gtmContainerId?: string | null;
  createdAt: string;
  creator?: { id: number; firstName: string; lastName?: string | null } | null;
  _count?: { enquiries: number; applications: number };
}

interface Stats {
  activeCampaigns: number;
  totalCampaigns: number;
  totalEnquiries: number;
  unresolvedEnquiries: number;
  totalApplications: number;
}

const STATUS_STYLES: Record<CampaignStatus, string> = {
  ACTIVE: "badge-approved",
  PAUSED: "badge-pending",
  SCHEDULED: "bg-secondary text-secondary-foreground",
  CLOSED: "bg-muted text-muted-foreground",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export default function LandingPageCampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        apiClient.get("/api/v1/landing-page-campaigns", { params: { limit: 50 } }),
        apiClient.get("/api/v1/landing-page-campaigns/stats"),
      ]);
      setCampaigns(listRes.data.campaigns ?? []);
      setStats(statsRes.data ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const copyId = (c: Campaign) => {
    navigator.clipboard?.writeText(c.uniqueId);
    setCopiedId(c.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Landing Page Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every campaign's unique ID is what the external landing page sends back with each submission — that's the whole integration contract.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New campaign
        </button>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Active campaigns" value={stats?.activeCampaigns ?? "—"} />
        <KpiCard label="Total campaigns" value={stats?.totalCampaigns ?? "—"} />
        <KpiCard label="Enquiries" value={stats?.totalEnquiries ?? "—"} />
        <KpiCard label="Unresolved" value={stats?.unresolvedEnquiries ?? "—"} />
        <KpiCard label="Dealer applications" value={stats?.totalApplications ?? "—"} />
      </section>

      {showCreate && <CreateCampaignForm onDone={() => { setShowCreate(false); load(); }} />}

      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Campaign</th>
              <th className="px-4 py-3 font-medium">Unique ID (webhook contract)</th>
              <th className="px-4 py-3 font-medium">Enquiries</th>
              <th className="px-4 py-3 font-medium">Applications</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Loading campaigns…</td></tr>
            ) : campaigns.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No campaigns yet — create one and hand its unique ID to whoever builds the landing page.</td></tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c.id} onClick={() => router.push(`/landing-page-campaigns/${c.id}`)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.name}</div>
                    {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.uniqueId.slice(0, 18)}…</code>
                      <button
                        onClick={(e) => { e.stopPropagation(); copyId(c); }}
                        className="text-muted-foreground hover:text-foreground"
                        title="Copy full unique ID"
                      >
                        {copiedId === c.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{c._count?.enquiries ?? 0}</td>
                  <td className="px-4 py-3 tabular-nums">{c._count?.applications ?? 0}</td>
                  <td className="px-4 py-3"><span className={`${STATUS_STYLES[c.status]} rounded-full px-2 py-0.5 text-xs`}>{c.status}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateCampaignForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: "", description: "", gtmContainerId: "" });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.post("/api/v1/landing-page-campaigns", form);
      setCreated(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not create campaign");
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <div className="mb-6 rounded-[var(--radius)] border border-primary/40 bg-card p-4">
        <p className="text-sm font-medium">"{created.name}" created.</p>
        <p className="mt-1 text-xs text-muted-foreground">Hand this unique ID to whoever builds the landing page — it goes in every webhook payload:</p>
        <code className="mt-2 block break-all rounded bg-muted px-2 py-1.5 text-xs">{created.uniqueId}</code>
        <button onClick={onDone} className="mt-3 inline-flex items-center gap-1 rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs hover:bg-accent">
          <ExternalLink className="h-3.5 w-3.5" /> Done
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-[var(--radius)] border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">New campaign</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <input placeholder="Campaign name (e.g. Dealer Expansion — Q1 2026 Google Ads)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="GTM container ID (e.g. GTM-XXXXXXX, optional)" value={form.gtmContainerId} onChange={(e) => setForm({ ...form, gtmContainerId: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm md:col-span-2" />
      </div>
      {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      <div className="mt-3">
        <button disabled={saving || !form.name} onClick={submit} className="rounded-[var(--radius)] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {saving ? "Creating…" : "Create campaign"}
        </button>
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
