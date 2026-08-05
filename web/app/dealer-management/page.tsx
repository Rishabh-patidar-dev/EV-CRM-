"use client";

// ============================================================================
// MODULE 2 — Dealer Management (operational dashboard)
// ============================================================================
// Route: /dealer-management
// Manages appointed dealers: network stats, filterable dealer list, and a
// detail panel showing territory, target-vs-actual, lead routing, finance
// cases, and after-sales (service + spares).
//
// Uses the shared axios client and design tokens already in the app. No heavy
// libraries or continuous animation — fast page, minimal motion, per the brief.
// ============================================================================
import React, { useEffect, useMemo, useState } from "react";
import {
  Users, MapPin, Wallet, Wrench, Search, Target as TargetIcon,
  TrendingUp, Package, ArrowUpRight, Building2,
} from "lucide-react";
import apiClient from "@/lib/api/client";

// ---- types (kept local; mirror the API responses) ----
type Tier = "STANDARD" | "PREMIUM" | "FLAGSHIP";
type OpStatus = "ONBOARDING" | "ACTIVE" | "ON_HOLD" | "SUSPENDED" | "TERMINATED";

interface DealerRow {
  id: number;
  dealerCode: string;
  legalName: string;
  tradeName?: string | null;
  principalName: string;
  state: string;
  city?: string | null;
  tier: Tier;
  status: OpStatus;
  segments: string[];
  relationshipManager?: { firstName?: string; lastName?: string } | null;
  _count?: { territories: number; leadAssignments: number; financeCases: number; serviceTickets: number };
}

interface Stats {
  totalDealers: number;
  statesCovered: number;
  openFinanceCases: number;
  openServiceTickets: number;
  byStatus: Record<string, number>;
  byTier: Record<string, number>;
  byState: { state: string; count: number }[];
}

const STATUS_STYLES: Record<OpStatus, string> = {
  ACTIVE: "badge-approved",
  ONBOARDING: "badge-pending",
  ON_HOLD: "badge-pending",
  SUSPENDED: "badge-rejected",
  TERMINATED: "badge-rejected",
};

const TIER_LABEL: Record<Tier, string> = {
  STANDARD: "Standard",
  PREMIUM: "Premium",
  FLAGSHIP: "Flagship",
};

export default function DealerManagementPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [dealers, setDealers] = useState<DealerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // ---- load list + stats ----
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params: Record<string, string> = {};
        if (search) params.search = search;
        if (stateFilter) params.state = stateFilter;
        if (statusFilter) params.status = statusFilter;
        if (tierFilter) params.tier = tierFilter;

        const [listRes, statsRes] = await Promise.all([
          apiClient.get("/api/v1/dealers", { params }),
          apiClient.get("/api/v1/dealers/stats"),
        ]);
        if (!active) return;
        setDealers(listRes.data.dealers ?? []);
        setStats(statsRes.data ?? null);
      } catch (e: any) {
        if (active) setError(e?.response?.data?.message ?? "Failed to load dealers");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [search, stateFilter, statusFilter, tierFilter]);

  const states = useMemo(
    () => (stats?.byState ?? []).map((s) => s.state).filter(Boolean),
    [stats]
  );

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dealer Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Operate the appointed dealer network — territory, targets, lead routing, finance and after-sales.
        </p>
      </header>

      {/* ---- KPI cards ---- */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard icon={<Users className="w-4 h-4" />} label="Active dealers" value={stats?.totalDealers ?? "—"} />
        <KpiCard icon={<MapPin className="w-4 h-4" />} label="States covered" value={stats?.statesCovered ?? "—"} />
        <KpiCard icon={<Wallet className="w-4 h-4" />} label="Open finance cases" value={stats?.openFinanceCases ?? "—"} />
        <KpiCard icon={<Wrench className="w-4 h-4" />} label="Open service tickets" value={stats?.openServiceTickets ?? "—"} />
      </section>

      {/* ---- filters ---- */}
      <section className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code, principal…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-[var(--radius)] border border-border bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <FilterSelect value={stateFilter} onChange={setStateFilter} placeholder="All states" options={states} />
        <FilterSelect value={tierFilter} onChange={setTierFilter} placeholder="All tiers" options={["STANDARD", "PREMIUM", "FLAGSHIP"]} />
        <FilterSelect value={statusFilter} onChange={setStatusFilter} placeholder="All statuses" options={["ACTIVE", "ONBOARDING", "ON_HOLD", "SUSPENDED", "TERMINATED"]} />
      </section>

      {error && (
        <div className="badge-rejected inline-block px-3 py-2 rounded-[var(--radius)] text-sm mb-4">{error}</div>
      )}

      {/* ---- list + detail ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
        <div className="rounded-[var(--radius)] border border-border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-4 py-3 font-medium">Dealer</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Tier</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Loading dealers…</td></tr>
              ) : dealers.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No dealers match these filters. Appoint one from an approved onboarding application to get started.</td></tr>
              ) : (
                dealers.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`border-b border-border last:border-0 cursor-pointer hover:bg-muted/50 ${selectedId === d.id ? "bg-muted/60" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{d.tradeName || d.legalName}</div>
                      <div className="text-xs text-muted-foreground">{d.dealerCode} · {d.principalName}</div>
                    </td>
                    <td className="px-4 py-3">{d.state}</td>
                    <td className="px-4 py-3">{TIER_LABEL[d.tier]}</td>
                    <td className="px-4 py-3">
                      <span className={`${STATUS_STYLES[d.status]} px-2 py-0.5 rounded-full text-xs`}>{d.status.replace("_", " ")}</span>
                    </td>
                    <td className="px-4 py-3 text-right"><ArrowUpRight className="w-4 h-4 text-muted-foreground inline" /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <DealerDetail dealerId={selectedId} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
function DealerDetail({ dealerId }: { dealerId: number | null }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dealerId) { setData(null); return; }
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await apiClient.get(`/api/v1/dealers/${dealerId}`);
        if (active) setData(res.data);
      } catch {
        if (active) setData(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [dealerId]);

  if (!dealerId) {
    return (
      <aside className="rounded-[var(--radius)] border border-border bg-card p-6 text-sm text-muted-foreground flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Select a dealer to see territory, targets and after-sales.
        </div>
      </aside>
    );
  }

  if (loading || !data) {
    return <aside className="rounded-[var(--radius)] border border-border bg-card p-6 text-sm text-muted-foreground">Loading…</aside>;
  }

  const att = data.currentAttainment ?? {};
  return (
    <aside className="rounded-[var(--radius)] border border-border bg-card p-5 space-y-5 self-start">
      <div>
        <h2 className="text-lg font-semibold">{data.tradeName || data.legalName}</h2>
        <p className="text-xs text-muted-foreground">{data.dealerCode} · {data.city ? `${data.city}, ` : ""}{data.state}</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {(data.segments ?? []).map((s: string) => (
            <span key={s} className="px-2 py-0.5 rounded-full text-xs border border-border">{s}</span>
          ))}
        </div>
      </div>

      {/* attainment */}
      <div>
        <SectionTitle icon={<TargetIcon className="w-3.5 h-3.5" />}>This month</SectionTitle>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Metric label="Units" value={`${att.unitsSold ?? 0} / ${att.unitTarget ?? 0}`} sub={att.unitTarget ? `${att.unitAttainmentPct ?? 0}% of target` : "no target set"} />
          <Metric label="Conversion" value={att.conversionPct != null ? `${att.conversionPct}%` : "—"} sub="leads → sales" />
        </div>
      </div>

      {/* territory */}
      <div>
        <SectionTitle icon={<MapPin className="w-3.5 h-3.5" />}>Territory</SectionTitle>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {(data.territories ?? []).length === 0 ? (
            <span className="text-xs text-muted-foreground">No territory assigned yet.</span>
          ) : (
            data.territories.map((t: any) => (
              <span key={t.id} className="px-2 py-0.5 rounded-[var(--radius)] text-xs border border-border">
                {t.district ? `${t.district}, ${t.state}` : t.state}{t.exclusive ? " ★" : ""}
              </span>
            ))
          )}
        </div>
      </div>

      {/* rollups */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <RollupCard icon={<TrendingUp className="w-3.5 h-3.5" />} label="Routed leads" value={(data.leadAssignments ?? []).length} />
        <RollupCard icon={<Wallet className="w-3.5 h-3.5" />} label="Finance" value={(data.financeCases ?? []).length} />
        <RollupCard icon={<Package className="w-3.5 h-3.5" />} label="Spares" value={(data.sparePartRequests ?? []).length} />
      </div>

      {/* recent service */}
      <div>
        <SectionTitle icon={<Wrench className="w-3.5 h-3.5" />}>Recent service tickets</SectionTitle>
        <ul className="mt-2 space-y-1.5">
          {(data.serviceTickets ?? []).slice(0, 5).map((t: any) => (
            <li key={t.id} className="flex items-center justify-between text-xs">
              <span className="truncate mr-2">{t.ticketNumber} · {t.issue}</span>
              <span className="text-muted-foreground shrink-0">{t.status.replace("_", " ")}</span>
            </li>
          ))}
          {(data.serviceTickets ?? []).length === 0 && (
            <li className="text-xs text-muted-foreground">No tickets logged.</li>
          )}
        </ul>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// small presentational helpers
// ---------------------------------------------------------------------------
function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">{icon}{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function FilterSelect({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 text-sm rounded-[var(--radius)] border border-border bg-card focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
    </select>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{icon}{children}</div>;
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function RollupCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius)] border border-border p-2.5">
      <div className="flex justify-center text-muted-foreground mb-1">{icon}</div>
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
