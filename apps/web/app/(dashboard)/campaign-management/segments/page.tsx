"use client";

// ============================================================================
// Campaign Management — Segments
// ============================================================================
// Route: /campaign-management/segments
// A segment is a saved filter over the Lead table (status/source/state) —
// membership is never stored, always recomputed live on load, so it can't
// go stale. Used as the audience picker on Email/WhatsApp campaigns.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import apiClient from "@/lib/api/client";

const STATUS_OPTIONS = ["OPEN", "WORKING", "QUALIFIED", "UNQUALIFIED", "NURTURING", "CONVERTED"];
const SOURCE_OPTIONS = ["IMPORT", "LANDING_PAGE", "MANUAL"];

interface SegmentRow {
  id: number;
  name: string;
  description: string | null;
  statusFilter: string | null;
  sourceFilter: string | null;
  stateFilter: string | null;
  memberCount: number;
}

export default function SegmentsPage() {
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get("/api/v1/campaign-management/segments");
      setSegments(data.segments ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: number) => {
    await apiClient.delete(`/api/v1/campaign-management/segments/${id}`);
    await load();
  };

  const filterSummary = (s: SegmentRow) => {
    const parts = [
      s.statusFilter && `status: ${s.statusFilter}`,
      s.sourceFilter && `source: ${s.sourceFilter}`,
      s.stateFilter && `state: ${s.stateFilter}`,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "All leads";
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Segments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Saved filters over your leads — used as the audience for Email and WhatsApp campaigns. Membership is always live, never a stale snapshot.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New segment
        </button>
      </header>

      {showForm && <NewSegmentForm onDone={() => { setShowForm(false); load(); }} />}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading segments…</p>
        ) : segments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No segments yet — create one to target a campaign.</p>
        ) : (
          segments.map((s) => (
            <div key={s.id} className="card-elevated p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h2 className="font-semibold">{s.name}</h2>
                <button onClick={() => remove(s.id)} className="shrink-0 text-muted-foreground hover:text-[color:var(--zira-rejected)]" title="Delete segment">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {s.description && <p className="mb-2 text-xs text-muted-foreground">{s.description}</p>}
              <p className="mb-3 text-xs text-muted-foreground">{filterSummary(s)}</p>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Users className="h-3.5 w-3.5 text-primary" /> {s.memberCount} leads
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function NewSegmentForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: "", description: "", statusFilter: "", sourceFilter: "", stateFilter: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post("/api/v1/campaign-management/segments", form);
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not create segment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-[var(--radius)] border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">New segment</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <input placeholder="Segment name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm md:col-span-2" />
        <input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm md:col-span-3" />
        <select value={form.statusFilter} onChange={(e) => setForm({ ...form, statusFilter: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          <option value="">Any status</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={form.sourceFilter} onChange={(e) => setForm({ ...form, sourceFilter: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          <option value="">Any source</option>
          {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <input placeholder="State (optional)" value={form.stateFilter} onChange={(e) => setForm({ ...form, stateFilter: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
      </div>
      {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      <div className="mt-3">
        <button
          disabled={saving || !form.name}
          onClick={submit}
          className="rounded-[var(--radius)] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Create segment"}
        </button>
      </div>
    </div>
  );
}
