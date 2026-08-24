"use client";

// ============================================================================
// MODULE 2 — Dealer Management (operational dashboard)
// ============================================================================
// Route: /dealer-management
// Network stats + a filterable dealer list. Clicking a dealer opens its own
// full-width detail page (/dealer-management/[id]) — territory, target vs
// actual, OEM<->dealer orders, service tickets — instead of a cramped side
// panel, so the detail view can take advantage of the whole screen.
//
// Uses the shared axios client and design tokens already in the app. No heavy
// libraries or continuous animation — fast page, minimal motion, per the brief.
// ============================================================================
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, MapPin, Wallet, Wrench, Search, ArrowUpRight } from "lucide-react";
import apiClient from "@/lib/api/client";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

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

const STATUS_TONE: Record<OpStatus, BadgeTone> = {
  ACTIVE: "approved",
  ONBOARDING: "pending",
  ON_HOLD: "pending",
  SUSPENDED: "rejected",
  TERMINATED: "rejected",
};

const TIER_LABEL: Record<Tier, string> = {
  STANDARD: "Standard",
  PREMIUM: "Premium",
  FLAGSHIP: "Flagship",
};

export default function DealerManagementPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [dealers, setDealers] = useState<DealerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");

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
    <div className="p-6 max-w-[1600px] mx-auto">
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

      {/* ---- list — full width; clicking a dealer opens its own detail page ---- */}
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
                  onClick={() => router.push(`/dealer-management/${d.id}`)}
                  className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/50"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.tradeName || d.legalName}</div>
                    <div className="text-xs text-muted-foreground">{d.dealerCode} · {d.principalName}</div>
                  </td>
                  <td className="px-4 py-3">{d.state}</td>
                  <td className="px-4 py-3">{TIER_LABEL[d.tier]}</td>
                  <td className="px-4 py-3">
                    <Badge status={d.status} tone={STATUS_TONE[d.status]} />
                  </td>
                  <td className="px-4 py-3 text-right"><ArrowUpRight className="w-4 h-4 text-muted-foreground inline" /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// small presentational helpers
// ---------------------------------------------------------------------------
function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card padding="compact">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">{icon}{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </Card>
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
