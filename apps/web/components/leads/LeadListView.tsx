"use client";

// ============================================================================
// LEAD MODULE — shared list view behind Lead Master / Assigned / Unassigned
// ============================================================================
// The three sidebar entries under Lead Management are the same underlying
// Lead table with a different default server-side filter (?assigned=true /
// ?unassigned=true, both already supported by GET /api/v1/leads) — one
// component instead of three near-identical copies.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Users, UserCheck, Gauge, Plus, Import, ClipboardCheck } from "lucide-react";
import apiClient from "@/lib/api/client";

type LeadStatus = "OPEN" | "WORKING" | "QUALIFIED" | "UNQUALIFIED" | "NURTURING" | "CONVERTED";
export type LeadListMode = "all" | "assigned" | "unassigned";

interface LeadRow {
  id: number;
  firstName: string;
  lastName?: string | null;
  email: string;
  phone?: string | null;
  companyName?: string | null;
  source: string;
  status: LeadStatus;
  score: number;
  owner?: { id: number; firstName: string; lastName?: string | null } | null;
}

interface Stats {
  total: number;
  unassigned: number;
  averageScore: number;
  byStatus: Record<string, number>;
}

interface UserOption {
  id: number;
  firstName: string;
  lastName?: string | null;
}

const STATUS_STYLES: Record<LeadStatus, string> = {
  OPEN: "bg-secondary text-secondary-foreground",
  WORKING: "bg-secondary text-secondary-foreground",
  QUALIFIED: "badge-approved",
  UNQUALIFIED: "badge-rejected",
  NURTURING: "badge-pending",
  CONVERTED: "badge-approved",
};

const STATUS_OPTIONS: LeadStatus[] = ["OPEN", "WORKING", "QUALIFIED", "UNQUALIFIED", "NURTURING", "CONVERTED"];

function displayName(p: { firstName: string; lastName?: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ");
}

export default function LeadListView({ mode, title, subtitle }: { mode: LeadListMode; title: string; subtitle: string }) {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [bulkOwnerId, setBulkOwnerId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (mode === "unassigned") params.unassigned = "true";
      if (mode === "assigned") params.assigned = "true";

      const [listRes, statsRes] = await Promise.all([
        apiClient.get("/api/v1/leads", { params }),
        apiClient.get("/api/v1/leads/stats"),
      ]);
      setLeads(listRes.data.leads ?? []);
      setStats(statsRes.data ?? null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, mode]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiClient.get("/api/v1/users").then((r) => setUsers(r.data.users ?? [])).catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {mode === "all" && (
          <div className="flex gap-2">
            <ImportCsvButton onDone={load} />
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> New lead
            </button>
          </div>
        )}
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={<Users className="h-4 w-4" />} label="Total leads" value={stats?.total ?? "—"} />
        <KpiCard icon={<UserCheck className="h-4 w-4" />} label="Unassigned" value={stats?.unassigned ?? "—"} />
        <KpiCard icon={<Gauge className="h-4 w-4" />} label="Average score" value={stats?.averageScore ?? "—"} />
        <KpiCard icon={<Users className="h-4 w-4" />} label="Qualified" value={stats?.byStatus?.QUALIFIED ?? 0} />
      </section>

      {mode === "all" && showCreate && <CreateLeadForm users={users} onDone={() => { setShowCreate(false); load(); }} />}

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone, company…"
            className="w-full rounded-[var(--radius)] border border-border bg-card py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </section>

      {mode !== "unassigned" && checked.size > 0 && (
        <section className="mb-4 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-primary/40 bg-accent px-3 py-2 text-sm">
          <span className="font-medium">{checked.size} selected</span>
          <select value={bulkOwnerId} onChange={(e) => setBulkOwnerId(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-2 py-1 text-sm">
            <option value="">Assign to…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{displayName(u)}</option>)}
          </select>
          <button
            disabled={!bulkOwnerId}
            onClick={async () => {
              await apiClient.post("/api/v1/leads/assign-bulk", { leadIds: Array.from(checked), ownerId: bulkOwnerId });
              setChecked(new Set());
              setBulkOwnerId("");
              load();
            }}
            className="rounded-[var(--radius)] bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Assign selected
          </button>
          <button onClick={() => setChecked(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Clear</button>
        </section>
      )}

      {error && <div className="badge-rejected mb-4 inline-block rounded-[var(--radius)] px-3 py-2 text-sm">{error}</div>}

      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="w-8 px-4 py-3">
                <input
                  type="checkbox"
                  checked={leads.length > 0 && checked.size === leads.length}
                  onChange={(e) => setChecked(e.target.checked ? new Set(leads.map((l) => l.id)) : new Set())}
                />
              </th>
              <th className="px-4 py-3 font-medium">Lead</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading leads…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No leads match these filters yet.</td></tr>
            ) : (
              leads.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => router.push(`/leads/${l.id}`)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked.has(l.id)}
                      onChange={(e) => {
                        const next = new Set(checked);
                        e.target.checked ? next.add(l.id) : next.delete(l.id);
                        setChecked(next);
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{displayName(l)}</div>
                    <div className="text-xs text-muted-foreground">{l.email}{l.companyName ? ` · ${l.companyName}` : ""}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{l.source}</td>
                  <td className="px-4 py-3 tabular-nums">{l.score}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.owner ? displayName(l.owner) : "Unassigned"}</td>
                  <td className="px-4 py-3">
                    <span className={`${STATUS_STYLES[l.status]} rounded-full px-2 py-0.5 text-xs`}>{l.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!l.owner && (
                      <button
                        onClick={async (e) => { e.stopPropagation(); await apiClient.put(`/api/v1/leads/${l.id}/claim`, {}); load(); }}
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                      >
                        <ClipboardCheck className="h-3 w-3" /> Claim
                      </button>
                    )}
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

function CreateLeadForm({ users, onDone }: { users: UserOption[]; onDone: () => void }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", companyName: "", city: "", state: "", ownerId: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post("/api/v1/leads", { ...form, ownerId: form.ownerId || undefined });
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not create lead");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-[var(--radius)] border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">New lead</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Company (optional)" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          <option value="">Unassigned</option>
          {users.map((u) => <option key={u.id} value={u.id}>{displayName(u)}</option>)}
        </select>
      </div>
      {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      <div className="mt-3">
        <button
          disabled={saving || !form.firstName || !form.email}
          onClick={submit}
          className="rounded-[var(--radius)] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Create lead"}
        </button>
      </div>
    </div>
  );
}

function ImportCsvButton({ onDone }: { onDone: () => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ insertedCount: number; skippedCount: number } | null>(null);

  const pick = () => inputRef.current?.click();

  const upload = async (file: File) => {
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await apiClient.post("/api/v1/leads/import", form, { headers: { "Content-Type": undefined } });
      setResult(data);
      onDone();
    } catch (e: any) {
      alert(e?.response?.data?.message ?? "Import failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="relative">
      <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <button
        onClick={pick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        title="Import a CSV of leads — download the template first from GET /api/v1/leads/import/template-csv"
      >
        <Import className="h-4 w-4" /> {busy ? "Importing…" : "Import CSV"}
      </button>
      {result && (
        <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-[var(--radius)] border border-border bg-card p-3 text-xs shadow-md">
          <p><b>{result.insertedCount}</b> imported, <b>{result.skippedCount}</b> skipped.</p>
          <button onClick={() => setResult(null)} className="mt-2 text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
