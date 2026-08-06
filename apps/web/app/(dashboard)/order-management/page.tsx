"use client";

// ============================================================================
// SUBMODULE — Order Management (manufacturer-wide view)
// ============================================================================
// Route: /order-management
// The Dealer 360 detail page shows one dealer's orders; this page is the
// manufacturer's order desk — every vehicle-stock and spare-part order
// across the whole dealer network: volume by zone/type/status, which zone
// orders which item most, order aging, top dealers by volume, a weekly
// trend, fulfillment rate, and a filterable combined order list with the
// same inline status-advance actions.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Package, Truck, ListChecks, Loader2, Clock, TrendingUp } from "lucide-react";
import apiClient from "@/lib/api/client";
import DonutChart from "@/components/charts/DonutChart";
import BarChart from "@/components/charts/BarChart";
import ChartCard from "@/components/charts/ChartCard";
import TargetBarChart from "@/components/charts/TargetBarChart";
import { StatCard } from "@/components/ui/StatCard";

const FLOW: Record<string, string> = { REQUESTED: "APPROVED", APPROVED: "DISPATCHED", DISPATCHED: "DELIVERED" };
const ORDER_STATUSES = ["REQUESTED", "APPROVED", "DISPATCHED", "DELIVERED", "REJECTED", "CANCELLED"];

interface Analytics {
  totalOrders: number;
  vehicleOrders: number;
  sparePartOrders: number;
  openOrders: number;
  avgOpenOrderAgeDays: number;
  fulfillmentRate: number | null;
  ordersByZone: { label: string; value: number }[];
  ordersByStatus: { label: string; value: number }[];
  ordersByType: { label: string; value: number }[];
  topVehicleModelByZone: { zone: string; topItem: string; quantity: number }[];
  topSparePartByZone: { zone: string; topItem: string; quantity: number }[];
  topDealersByVolume: { label: string; value: number; zone: string }[];
  weeklyTrend: { label: string; value: number }[];
  fulfillmentByZone: { zone: string; rate: number; statusLabel: string }[];
  oldestOpenOrders: { type: string; orderNumber: string; dealer: string; zone: string; item: string; daysOpen: number; status: string }[];
}

interface OrderRow {
  id: number;
  type: "VEHICLE" | "SPARE_PART";
  orderNumber: string;
  dealerId: number;
  dealer: { id: number; dealerCode: string; legalName: string; tradeName: string | null; state: string } | null;
  item: string;
  quantity: number;
  status: string;
  createdAt: string;
}

export default function OrderManagementPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [zoneFilter, setZoneFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const loadAnalytics = useCallback(async () => {
    const { data } = await apiClient.get("/api/v1/order-management/analytics");
    setAnalytics(data);
  }, []);

  const loadOrders = useCallback(async () => {
    const params: Record<string, string> = { limit: "100" };
    if (zoneFilter) params.zone = zoneFilter;
    if (statusFilter) params.status = statusFilter;
    if (typeFilter) params.type = typeFilter;
    const { data } = await apiClient.get("/api/v1/order-management/orders", { params });
    setOrders(data.orders ?? []);
  }, [zoneFilter, statusFilter, typeFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadAnalytics(), loadOrders()]);
    } finally {
      setLoading(false);
    }
  }, [loadAnalytics, loadOrders]);

  useEffect(() => { refresh(); }, [refresh]);

  const advance = async (order: OrderRow, status: string) => {
    const path = order.type === "VEHICLE" ? "stock-transfers" : "spare-parts";
    await apiClient.patch(`/api/v1/${path}/${order.id}`, { status });
    await refresh();
  };

  const zones = Array.from(new Set((analytics?.ordersByZone ?? []).map((z) => z.label))).sort();

  return (
    <div className="mx-auto max-w-[1700px] p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Order Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The manufacturer's order desk — every vehicle-stock and spare-part order the dealer network has raised, by zone, by dealer, and how fast it's moving.
        </p>
      </header>

      {/* KPI row */}
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={<ListChecks className="h-3.5 w-3.5" />} label="Total orders" value={analytics?.totalOrders ?? "—"} />
        <StatCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Open orders"
          value={analytics?.openOrders ?? "—"}
          trend={analytics ? `avg ${analytics.avgOpenOrderAgeDays}d open` : undefined}
          trendDirection={analytics && analytics.avgOpenOrderAgeDays > 7 ? "down" : "up"}
        />
        <StatCard icon={<TrendingUp className="h-3.5 w-3.5" />} label="Fulfillment rate" value={analytics?.fulfillmentRate != null ? `${analytics.fulfillmentRate}%` : "—"} />
        <StatCard icon={<Truck className="h-3.5 w-3.5" />} label="Vehicle stock orders" value={analytics?.vehicleOrders ?? "—"} />
        <StatCard icon={<Package className="h-3.5 w-3.5" />} label="Spare part orders" value={analytics?.sparePartOrders ?? "—"} />
      </section>

      {/* Weekly trend + type split */}
      <section className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard title="Weekly order volume" subtitle="Last 8 weeks, combined vehicle + spare-part orders" className="lg:col-span-2">
          {analytics && analytics.weeklyTrend.some((w) => w.value > 0) ? (
            <BarChart data={analytics.weeklyTrend} />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No orders yet.</p>
          )}
        </ChartCard>
        <ChartCard title="Orders by type" subtitle="Vehicle stock vs. spare parts">
          {analytics && analytics.ordersByType.some((d) => d.value > 0) ? (
            <DonutChart data={analytics.ordersByType} centerLabel="orders" />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No orders yet.</p>
          )}
        </ChartCard>
      </section>

      {/* Zone + status + top dealers */}
      <section className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard title="Orders by zone" subtitle="Total quantity ordered, by dealer state">
          {analytics && analytics.ordersByZone.length > 0 ? (
            <BarChart data={analytics.ordersByZone} />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No zone demand data yet.</p>
          )}
        </ChartCard>
        <ChartCard title="Orders by status" subtitle="Open vs. resolved mix">
          {analytics && analytics.ordersByStatus.length > 0 ? (
            <DonutChart data={analytics.ordersByStatus} centerLabel="orders" />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No orders yet.</p>
          )}
        </ChartCard>
        <ChartCard title="Top dealers by order volume" subtitle="Order count, all-time">
          {analytics && analytics.topDealersByVolume.length > 0 ? (
            <BarChart data={analytics.topDealersByVolume} color="var(--viz-3)" />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No orders yet.</p>
          )}
        </ChartCard>
      </section>

      {/* Fulfillment + oldest open orders */}
      <section className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Fulfillment rate by zone" subtitle="Delivered ÷ (Delivered + Rejected + Cancelled)">
          {analytics && analytics.fulfillmentByZone.length > 0 ? (
            <TargetBarChart data={analytics.fulfillmentByZone.map((f) => ({ label: f.zone, value: f.rate, statusLabel: f.statusLabel }))} scaleMax={110} />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No resolved orders yet.</p>
          )}
        </ChartCard>
        <ChartCard title="Oldest open orders" subtitle="Sitting in Requested / Approved / Dispatched the longest">
          {analytics && analytics.oldestOpenOrders.length > 0 ? (
            <ul className="space-y-2">
              {analytics.oldestOpenOrders.map((o) => (
                <li key={`${o.type}-${o.orderNumber}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{o.orderNumber} · {o.dealer} ({o.zone}) · {o.item}</span>
                  <OrderStatusBadge status={o.status} />
                  <span className={`shrink-0 rounded-full px-2 py-0.5 tabular-nums ${o.daysOpen > 7 ? "badge-rejected" : "bg-accent text-accent-foreground"}`}>{o.daysOpen}d</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No open orders — fully caught up.</p>
          )}
        </ChartCard>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Most-ordered vehicle model, by zone</h2>
          <TopByZoneList rows={analytics?.topVehicleModelByZone ?? []} empty="No vehicle stock orders yet." />
        </div>
        <div className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Most-ordered spare part, by zone</h2>
          <TopByZoneList rows={analytics?.topSparePartByZone ?? []} empty="No spare part orders yet." />
        </div>
      </section>

      {/* filters */}
      <section className="mb-4 flex flex-wrap items-center gap-2">
        <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All zones</option>
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All order types</option>
          <option value="VEHICLE">Vehicle stock</option>
          <option value="SPARE_PART">Spare parts</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </section>

      {/* combined order list */}
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">Zone</th>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No orders match these filters.</td></tr>
            ) : (
              orders.map((o) => (
                <tr key={`${o.type}-${o.id}`} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{o.orderNumber}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs">{o.type === "VEHICLE" ? "Vehicle" : "Spare part"}</span>
                  </td>
                  <td className="px-4 py-3">
                    {o.dealer ? (
                      <Link href={`/dealer-management/${o.dealer.id}`} className="hover:underline">
                        {o.dealer.tradeName || o.dealer.legalName}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{o.dealer?.state ?? "—"}</td>
                  <td className="px-4 py-3">{o.item} × {o.quantity}</td>
                  <td className="px-4 py-3"><OrderStatusBadge status={o.status} /></td>
                  <td className="px-4 py-3 text-right">
                    {FLOW[o.status] && (
                      <button onClick={() => advance(o, FLOW[o.status])} className="rounded border border-border px-2 py-1 text-xs hover:bg-accent">
                        Mark {FLOW[o.status].toLowerCase()}
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

function TopByZoneList({ rows, empty }: { rows: { zone: string; topItem: string; quantity: number }[]; empty: string }) {
  if (rows.length === 0) return <p className="py-8 text-center text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.slice(0, 8).map((r) => (
        <li key={r.zone} className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-foreground">{r.zone}</span>
          <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">{r.topItem}</span>
          <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 tabular-nums text-accent-foreground">{r.quantity}</span>
        </li>
      ))}
    </ul>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const style = status === "DELIVERED" ? "badge-approved" : status === "REJECTED" || status === "CANCELLED" ? "badge-rejected" : "badge-pending";
  return <span className={`${style} shrink-0 rounded-full px-2 py-0.5 text-xs`}>{status.replace("_", " ")}</span>;
}
