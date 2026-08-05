"use client";

// ============================================================================
// Campaign Management — shared list behind Email Campaigns / WhatsApp
// Campaigns. Sending is NOT wired to a live provider (no SMTP/WhatsApp
// Business API in this scaffold) — "Send" snapshots the target segment's
// live member count as the audience and moves the campaign to Sent. There's
// no open/click/bounce data because none of that would be real.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import { Plus, Send, Calendar } from "lucide-react";
import apiClient from "@/lib/api/client";

export type CampaignChannel = "EMAIL" | "WHATSAPP";

interface Segment {
  id: number;
  name: string;
  memberCount: number;
}

interface Campaign {
  id: number;
  name: string;
  channel: CampaignChannel;
  subject: string | null;
  message: string;
  status: "DRAFT" | "SCHEDULED" | "SENT";
  segment: { id: number; name: string } | null;
  scheduledAt: string | null;
  sentAt: string | null;
  audienceCount: number | null;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-secondary text-secondary-foreground",
  SCHEDULED: "badge-pending",
  SENT: "badge-approved",
};

export default function CampaignListView({ channel, title, subtitle }: { channel: CampaignChannel; title: string; subtitle: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [campaignsRes, segmentsRes] = await Promise.all([
        apiClient.get("/api/v1/campaign-management/campaigns", { params: { channel } }),
        apiClient.get("/api/v1/campaign-management/segments"),
      ]);
      setCampaigns(campaignsRes.data.campaigns ?? []);
      setSegments(segmentsRes.data.segments ?? []);
    } finally {
      setLoading(false);
    }
  }, [channel]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: number, status: string) => {
    await apiClient.patch(`/api/v1/campaign-management/campaigns/${id}`, { status });
    await load();
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New campaign
        </button>
      </header>

      {showForm && <NewCampaignForm channel={channel} segments={segments} onDone={() => { setShowForm(false); load(); }} />}

      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Campaign</th>
              <th className="px-4 py-3 font-medium">Segment</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Audience</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Loading campaigns…</td></tr>
            ) : campaigns.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No campaigns yet.</td></tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.name}</div>
                    {c.subject && <div className="text-xs text-muted-foreground">{c.subject}</div>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.segment?.name ?? "—"}</td>
                  <td className="px-4 py-3"><span className={`${STATUS_STYLES[c.status]} rounded-full px-2 py-0.5 text-xs`}>{c.status}</span></td>
                  <td className="px-4 py-3 tabular-nums">{c.audienceCount ?? (c.segment ? segments.find((s) => s.id === c.segment!.id)?.memberCount ?? "—" : "—")}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      {c.status === "DRAFT" && (
                        <button onClick={() => setStatus(c.id, "SCHEDULED")} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent">
                          <Calendar className="h-3 w-3" /> Schedule
                        </button>
                      )}
                      {c.status !== "SENT" && (
                        <button onClick={() => setStatus(c.id, "SENT")} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent">
                          <Send className="h-3 w-3" /> Send now
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewCampaignForm({ channel, segments, onDone }: { channel: CampaignChannel; segments: Segment[]; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", subject: "", message: "", segmentId: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post("/api/v1/campaign-management/campaigns", { ...form, channel, segmentId: form.segmentId || undefined });
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not create campaign");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-[var(--radius)] border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">New {channel === "EMAIL" ? "email" : "WhatsApp"} campaign</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <input placeholder="Campaign name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        {channel === "EMAIL" && (
          <input placeholder="Subject line" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm md:col-span-2" />
        )}
        <select value={form.segmentId} onChange={(e) => setForm({ ...form, segmentId: e.target.value })} className={`rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm ${channel === "EMAIL" ? "" : "md:col-span-3"}`}>
          <option value="">No segment (audience TBD)</option>
          {segments.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.memberCount} leads</option>)}
        </select>
        <textarea placeholder={channel === "EMAIL" ? "Email body" : "WhatsApp message"} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="col-span-2 rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm md:col-span-4" rows={3} />
      </div>
      {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      <div className="mt-3">
        <button
          disabled={saving || !form.name || !form.message}
          onClick={submit}
          className="rounded-[var(--radius)] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Create campaign"}
        </button>
      </div>
    </div>
  );
}
