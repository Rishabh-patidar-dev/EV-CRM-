"use client";

// ============================================================================
// NEW SUBMODULE — Vehicle Inventory & Stock Allocation
// ============================================================================
// Route: /dealer-inventory[?dealerId=]
// VIN-level stock (OEM warehouse -> allocated -> demo/sold) plus the dealer
// stock-transfer request queue. Optionally pre-filtered to a single dealer
// via the ?dealerId= query param (linked from Dealer Management).
// ============================================================================
import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Warehouse, Plus, Search, Truck, Loader2, MapPin, TrendingUp, PackageSearch, RefreshCw } from "lucide-react";
import apiClient from "@/lib/api/client";
import DonutChart from "@/components/charts/DonutChart";
import BarChart from "@/components/charts/BarChart";
import { VEHICLE_IMAGES } from "@/lib/vehicleCatalog";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const UNIT_STATUSES = ["IN_TRANSIT", "IN_STOCK", "ALLOCATED", "DEMO", "SOLD", "SERVICE_HOLD", "DAMAGED"];
const TRANSFER_STATUSES = ["REQUESTED", "APPROVED", "DISPATCHED", "DELIVERED", "REJECTED", "CANCELLED"];
const SEGMENTS = ["L5", "L3", "CUSTOMISED"];

const STATUS_TONE: Record<string, BadgeTone> = {
  IN_STOCK: "approved",
  ALLOCATED: "pending",
  DEMO: "pending",
  SOLD: "approved",
  IN_TRANSIT: "pending",
  SERVICE_HOLD: "rejected",
  DAMAGED: "rejected",
  REQUESTED: "pending",
  APPROVED: "pending",
  DISPATCHED: "pending",
  DELIVERED: "approved",
  REJECTED: "rejected",
  CANCELLED: "rejected",
};

interface Dealer {
  id: number;
  dealerCode: string;
  legalName: string;
  tradeName?: string | null;
}

export default function DealerInventoryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <DealerInventoryInner />
    </Suspense>
  );
}

function DealerInventoryInner() {
  const searchParams = useSearchParams();
  const dealerIdParam = searchParams.get("dealerId") ?? "";
  // GlobalSearch (TopBar) sends a matched VIN/model here as ?q= — seeds the
  // existing search box below instead of adding a second filter mechanism.
  const qParam = searchParams.get("q") ?? "";

  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<{
    stockByModel: { label: string; value: number }[];
    ordersByZone: { label: string; value: number }[];
    ordersByModel: { label: string; value: number }[];
    topModelByZone: { zone: string; topModel: string; quantity: number; totalOrders: number }[];
    oemAvailableByModel: { model: string; segment: string; quantity: number }[];
    totalActiveStock: number;
    totalUnits: number;
  } | null>(null);
  const [spareParts, setSpareParts] = useState<{ id: number; partName: string; partCode: string | null; quantityOnHand: number }[]>([]);

  const [dealerFilter, setDealerFilter] = useState(dealerIdParam);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState(qParam);
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDealers = useCallback(async () => {
    const { data } = await apiClient.get("/api/v1/dealers", { params: { limit: 100 } });
    setDealers(data.dealers ?? []);
  }, []);

  const loadUnits = useCallback(async () => {
    const params: Record<string, string> = { limit: "100" };
    if (dealerFilter) params.dealerId = dealerFilter;
    if (statusFilter) params.status = statusFilter;
    if (search) params.search = search;
    const { data } = await apiClient.get("/api/v1/vehicle-units", { params });
    setUnits(data.units ?? []);
    setByStatus(data.byStatus ?? {});
  }, [dealerFilter, statusFilter, search]);

  const loadTransfers = useCallback(async () => {
    const params: Record<string, string> = { limit: "50" };
    if (dealerFilter) params.dealerId = dealerFilter;
    const { data } = await apiClient.get("/api/v1/stock-transfers", { params });
    setTransfers(data.transfers ?? []);
  }, [dealerFilter]);

  const loadAnalytics = useCallback(async () => {
    const { data } = await apiClient.get("/api/v1/vehicle-units/analytics");
    setAnalytics(data);
  }, []);

  const loadSpareParts = useCallback(async () => {
    const { data } = await apiClient.get("/api/v1/spare-part-inventory");
    setSpareParts(data.items ?? []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await Promise.all([loadUnits(), loadTransfers(), loadAnalytics(), loadSpareParts()]);
    } catch (error: any) {
      console.error("[DealerInventoryPage] failed to load inventory data:", error);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load inventory data. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [loadUnits, loadTransfers, loadAnalytics, loadSpareParts]);

  useEffect(() => {
    loadDealers();
  }, [loadDealers]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateTransferStatus = async (id: number, status: string) => {
    await apiClient.patch(`/api/v1/stock-transfers/${id}`, { status });
    await loadTransfers();
  };

  const dealerLabel = (id: number | null) => {
    if (!id) return "OEM warehouse";
    const d = dealers.find((x) => x.id === id);
    return d ? d.tradeName || d.legalName : `Dealer #${id}`;
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehicle Inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            VIN-level stock from OEM warehouse through allocation, demo fleet and sale.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowTransferForm((v) => !v)}>
            <Truck className="h-4 w-4" /> Request stock
          </Button>
          <Button onClick={() => setShowUnitForm((v) => !v)}>
            <Plus className="h-4 w-4" /> Register unit
          </Button>
        </div>
      </header>

      {loadError && (
        <div className="mb-6 rounded-[var(--radius)] border border-dashed border-[color:var(--zira-rejected)]/40 p-4 text-center text-[color:var(--zira-rejected)]">
          {loadError}
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      )}

      {/* Gallery — how much of each vehicle is actually left at the OEM
          warehouse right now (dealerId = null, IN_STOCK), the same number
          Check Inventory compares against. Photo + count only, no card
          chrome, so it reads as a catalog rather than another data table. */}
      {analytics && analytics.oemAvailableByModel.some((m) => VEHICLE_IMAGES[m.model]) && (
        <section className="mb-8">
          <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Manufacturer stock on hand</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
            {analytics.oemAvailableByModel
              .filter((m) => VEHICLE_IMAGES[m.model])
              .map((m) => (
                <div key={`${m.model}-${m.segment}`} className="flex flex-col items-center text-center">
                  <img
                    src={VEHICLE_IMAGES[m.model]}
                    alt={m.model}
                    className="h-32 w-full object-contain drop-shadow-sm transition-transform hover:scale-105 sm:h-36"
                  />
                  <div className="mt-3 text-sm font-medium">{m.model}</div>
                  <div className="text-[11px] text-muted-foreground">{m.segment}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{m.quantity}</div>
                  <div className="text-[11px] text-muted-foreground">in stock</div>
                </div>
              ))}
          </div>

          {spareParts.length > 0 && (
            <div className="mt-8 border-t border-border pt-6">
              <h3 className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                <PackageSearch className="h-4 w-4" /> Spare parts on hand
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
                {spareParts.map((p) => (
                  <div key={p.id} className="flex flex-col items-center text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/60">
                      <PackageSearch className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-xs font-medium">{p.partName}</div>
                    <div className="mt-1 text-xl font-semibold tabular-nums">{p.quantityOnHand}</div>
                    <div className="text-[11px] text-muted-foreground">in stock</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* KPI row */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {UNIT_STATUSES.map((s) => (
          <Card key={s} padding="compact">
            <div className="text-[11px] text-muted-foreground">{s.replace("_", " ")}</div>
            <div className="text-xl font-semibold">{byStatus[s] ?? 0}</div>
          </Card>
        ))}
      </section>

      {/* BI dashboard — stock mix + dealer demand, all derived from the units
          and stock-transfer requests already in the tables below. */}
      <section className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card padding="compact">
          <h2 className="mb-3 text-sm font-semibold">Stock by status</h2>
          {Object.values(byStatus).some((v) => v > 0) ? (
            <DonutChart data={UNIT_STATUSES.map((s) => ({ label: s.replace("_", " "), value: byStatus[s] ?? 0 }))} centerLabel="units" />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No units on record yet.</p>
          )}
        </Card>

        <Card padding="compact">
          <h2 className="mb-3 text-sm font-semibold">Live stock by model</h2>
          {analytics && analytics.stockByModel.length > 0 ? (
            <DonutChart data={analytics.stockByModel} centerLabel="in network" />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No stock on record yet.</p>
          )}
        </Card>

        <Card padding="compact">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <MapPin className="h-3.5 w-3.5" /> Dealer stock orders by zone
          </h2>
          {analytics && analytics.ordersByZone.length > 0 ? (
            <BarChart data={analytics.ordersByZone} />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No stock transfer requests yet.</p>
          )}
        </Card>

        <Card padding="compact">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <TrendingUp className="h-3.5 w-3.5" /> Most-ordered model, by zone
          </h2>
          {analytics && analytics.topModelByZone.length > 0 ? (
            <ul className="space-y-2">
              {analytics.topModelByZone.slice(0, 6).map((z) => (
                <li key={z.zone} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-foreground">{z.zone}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">{z.topModel}</span>
                  <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 tabular-nums text-accent-foreground">{z.quantity}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No zone demand data yet.</p>
          )}
        </Card>
      </section>

      {showUnitForm && <RegisterUnitForm dealers={dealers} onDone={() => { setShowUnitForm(false); refresh(); }} />}
      {showTransferForm && <RequestStockForm dealers={dealers} onDone={() => { setShowTransferForm(false); loadTransfers(); }} />}

      {/* filters */}
      <section className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search VIN, model, buyer…"
            className="w-full rounded-[var(--radius)] border border-border bg-card py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={dealerFilter}
          onChange={(e) => setDealerFilter(e.target.value)}
          className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm"
        >
          <option value="">All dealers</option>
          <option value="null">OEM warehouse</option>
          {dealers.map((d) => (
            <option key={d.id} value={d.id}>{d.tradeName || d.legalName}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {UNIT_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </section>

      {/* units table */}
      <div className="mb-8 overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">VIN</th>
              <th className="px-4 py-3 font-medium">Model</th>
              <th className="px-4 py-3 font-medium">Segment</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : units.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No vehicle units match these filters.</td></tr>
            ) : (
              units.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{u.vin}</td>
                  <td className="px-4 py-3">{u.model}{u.isDemoUnit && <span className="ml-1.5 text-xs text-muted-foreground">(demo)</span>}</td>
                  <td className="px-4 py-3">{u.segment}</td>
                  <td className="px-4 py-3">{u.dealer ? (u.dealer.tradeName || u.dealer.legalName) : "OEM warehouse"}</td>
                  <td className="px-4 py-3"><Badge status={u.status} tone={STATUS_TONE[u.status] ?? "neutral"} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* stock transfer requests */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Warehouse className="h-4 w-4" /> Stock transfer requests
        </h2>
        <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Request</th>
                <th className="px-4 py-3 font-medium">Dealer</th>
                <th className="px-4 py-3 font-medium">Model / qty</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {transfers.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No stock transfer requests yet.</td></tr>
              ) : (
                transfers.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{t.requestNumber}</td>
                    <td className="px-4 py-3">{t.dealer?.tradeName || t.dealer?.legalName || dealerLabel(t.dealerId)}</td>
                    <td className="px-4 py-3">{t.model} × {t.quantity} <span className="text-muted-foreground">({t.segment})</span></td>
                    <td className="px-4 py-3"><Badge status={t.status} tone={STATUS_TONE[t.status] ?? "neutral"} /></td>
                    <td className="px-4 py-3 text-right">
                      <TransferActions status={t.status} onAdvance={(s) => updateTransferStatus(t.id, s)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TransferActions({ status, onAdvance }: { status: string; onAdvance: (status: string) => void }) {
  const NEXT: Record<string, string> = { REQUESTED: "APPROVED", APPROVED: "DISPATCHED", DISPATCHED: "DELIVERED" };
  const next = NEXT[status];
  if (!next) return null;
  return (
    <div className="flex justify-end gap-1.5">
      <Button size="sm" variant="secondary" onClick={() => onAdvance(next)}>
        Mark {next.toLowerCase()}
      </Button>
      {status === "REQUESTED" && (
        <Button size="sm" variant="secondary" onClick={() => onAdvance("REJECTED")}>
          Reject
        </Button>
      )}
    </div>
  );
}

function RegisterUnitForm({ dealers, onDone }: { dealers: Dealer[]; onDone: () => void }) {
  const [form, setForm] = useState({ vin: "", model: "", segment: "L5", color: "", dealerId: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post("/api/v1/vehicle-units", {
        ...form,
        dealerId: form.dealerId ? parseInt(form.dealerId) : null,
      });
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not register unit");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="compact" className="mb-6">
      <h3 className="mb-3 text-sm font-semibold">Register a new vehicle unit</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <input placeholder="VIN / chassis no." value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Model (e.g. Vikas Lifter)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input placeholder="Color (optional)" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <select value={form.dealerId} onChange={(e) => setForm({ ...form, dealerId: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          <option value="">OEM warehouse</option>
          {dealers.map((d) => <option key={d.id} value={d.id}>{d.tradeName || d.legalName}</option>)}
        </select>
      </div>
      {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={saving || !form.vin || !form.model} onClick={submit}>
          {saving ? "Saving…" : "Register unit"}
        </Button>
      </div>
    </Card>
  );
}

function RequestStockForm({ dealers, onDone }: { dealers: Dealer[]; onDone: () => void }) {
  const [form, setForm] = useState({ dealerId: "", model: "", segment: "L5", quantity: 1 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post("/api/v1/stock-transfers", { ...form, dealerId: parseInt(form.dealerId) });
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not create request");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="compact" className="mb-6">
      <h3 className="mb-3 text-sm font-semibold">Request stock for a dealer</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <select value={form.dealerId} onChange={(e) => setForm({ ...form, dealerId: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          <option value="">Select dealer…</option>
          {dealers.map((d) => <option key={d.id} value={d.id}>{d.tradeName || d.legalName}</option>)}
        </select>
        <input placeholder="Model (e.g. Vikas Rani)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
      </div>
      {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={saving || !form.dealerId || !form.model} onClick={submit}>
          {saving ? "Sending…" : "Send request"}
        </Button>
      </div>
    </Card>
  );
}
