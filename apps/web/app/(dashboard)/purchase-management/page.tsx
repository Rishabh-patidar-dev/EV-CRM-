"use client";

// ============================================================================
// SUBMODULE — Purchase Management (manufacturer's own inbound stock)
// ============================================================================
// Route: /purchase-management
// Distinct from Order Management (dealer -> OEM orders): this is the OEM's
// own procurement — batches of vehicles bought from a manufacturing plant or
// import source, tracked as a purchase order (Ordered -> In Transit ->
// Received, or Cancelled). "Sold" figures are read directly from
// VehicleUnit.status = SOLD, the real sales record Vehicle Inventory already
// keeps — imported vs. sold is a genuine cross-reference, not two invented
// halves of the same number.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import { ShoppingCart, PackageCheck, TrendingDown, Wallet, Plus, Loader2 } from "lucide-react";
import apiClient from "@/lib/api/client";
import DonutChart from "@/components/charts/DonutChart";
import ChartCard from "@/components/charts/ChartCard";
import { StatCard } from "@/components/ui/StatCard";

const SEGMENTS = ["L5", "L3", "CUSTOMISED"];
const PO_STATUSES = ["ORDERED", "IN_TRANSIT", "RECEIVED", "CANCELLED"];
const FLOW: Record<string, string> = { ORDERED: "IN_TRANSIT", IN_TRANSIT: "RECEIVED" };

interface Analytics {
  totalOrderedQty: number;
  totalReceivedQty: number;
  totalSold: number;
  netStockMovement: number;
  totalSpend: number;
  importedByModel: { label: string; value: number }[];
  soldByModel: { label: string; value: number }[];
  poStatusBreakdown: { label: string; value: number }[];
}

interface PurchaseOrder {
  id: number;
  poNumber: string;
  supplierName: string;
  model: string;
  segment: string;
  quantity: number;
  unitCost: string;
  status: string;
  orderedAt: string;
  expectedAt: string | null;
  receivedAt: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  ORDERED: "badge-pending",
  IN_TRANSIT: "badge-pending",
  RECEIVED: "badge-approved",
  CANCELLED: "badge-rejected",
};

export default function PurchaseManagementPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const loadAnalytics = useCallback(async () => {
    const { data } = await apiClient.get("/api/v1/purchase-management/analytics");
    setAnalytics(data);
  }, []);

  const loadOrders = useCallback(async () => {
    const params: Record<string, string> = { limit: "100" };
    if (statusFilter) params.status = statusFilter;
    const { data } = await apiClient.get("/api/v1/purchase-management/orders", { params });
    setOrders(data.orders ?? []);
  }, [statusFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadAnalytics(), loadOrders()]);
    } finally {
      setLoading(false);
    }
  }, [loadAnalytics, loadOrders]);

  useEffect(() => { refresh(); }, [refresh]);

  const advance = async (order: PurchaseOrder, status: string) => {
    await apiClient.patch(`/api/v1/purchase-management/orders/${order.id}`, { status });
    await refresh();
  };

  return (
    <div className="mx-auto max-w-[1600px] p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The manufacturer's own inbound stock — purchase orders from the plant or import source, and how that compares to what's actually being sold.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New purchase order
        </button>
      </header>

      {/* KPI row */}
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={<ShoppingCart className="h-3.5 w-3.5" />} label="Total ordered" value={analytics?.totalOrderedQty ?? "—"} />
        <StatCard icon={<PackageCheck className="h-3.5 w-3.5" />} label="Received into stock" value={analytics?.totalReceivedQty ?? "—"} />
        <StatCard icon={<TrendingDown className="h-3.5 w-3.5" />} label="Sold" value={analytics?.totalSold ?? "—"} />
        <StatCard
          icon={<ShoppingCart className="h-3.5 w-3.5" />}
          label="Net stock movement"
          value={analytics ? (analytics.netStockMovement >= 0 ? `+${analytics.netStockMovement}` : analytics.netStockMovement) : "—"}
        />
        <StatCard icon={<Wallet className="h-3.5 w-3.5" />} label="Spend on received stock" value={analytics ? `₹${analytics.totalSpend.toLocaleString("en-IN")}` : "—"} />
      </section>

      {/* BI dashboard */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard title="Imported by model" subtitle="Purchase orders marked Received, by vehicle model">
          {analytics && analytics.importedByModel.length > 0 ? (
            <DonutChart data={analytics.importedByModel} centerLabel="units" />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No received purchase orders yet.</p>
          )}
        </ChartCard>
        <ChartCard title="Sold by model" subtitle="From Vehicle Inventory — units marked Sold">
          {analytics && analytics.soldByModel.length > 0 ? (
            <DonutChart data={analytics.soldByModel} centerLabel="units" />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No sales on record yet.</p>
          )}
        </ChartCard>
        <ChartCard title="Purchase order status" subtitle="Where every PO currently sits">
          {analytics && analytics.poStatusBreakdown.length > 0 ? (
            <DonutChart data={analytics.poStatusBreakdown} centerLabel="orders" />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No purchase orders yet.</p>
          )}
        </ChartCard>
      </section>

      {showForm && <NewPurchaseOrderForm onDone={() => { setShowForm(false); refresh(); }} />}

      {/* filter */}
      <section className="mb-4 flex flex-wrap items-center gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {PO_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </section>

      {/* purchase order list */}
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">PO</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
              <th className="px-4 py-3 font-medium">Model / qty</th>
              <th className="px-4 py-3 font-medium">Unit cost</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No purchase orders yet.</td></tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{o.poNumber}</td>
                  <td className="px-4 py-3">{o.supplierName}</td>
                  <td className="px-4 py-3">{o.model} × {o.quantity} <span className="text-muted-foreground">({o.segment})</span></td>
                  <td className="px-4 py-3 tabular-nums">₹{Number(o.unitCost).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3"><span className={`${STATUS_BADGE[o.status] ?? "bg-muted"} rounded-full px-2 py-0.5 text-xs`}>{o.status.replace("_", " ")}</span></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      {FLOW[o.status] && (
                        <button onClick={() => advance(o, FLOW[o.status])} className="rounded border border-border px-2 py-1 text-xs hover:bg-accent">
                          Mark {FLOW[o.status].toLowerCase().replace("_", " ")}
                        </button>
                      )}
                      {(o.status === "ORDERED" || o.status === "IN_TRANSIT") && (
                        <button onClick={() => advance(o, "CANCELLED")} className="rounded border border-border px-2 py-1 text-xs hover:bg-accent">
                          Cancel
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

function NewPurchaseOrderForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ supplierName: "", model: "", segment: "L5", quantity: 1, unitCost: "", expectedAt: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post("/api/v1/purchase-management/orders", { ...form, expectedAt: form.expectedAt || undefined });
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not create purchase order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-[var(--radius)] border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">New purchase order</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <input placeholder="Supplier / plant name" value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Model (e.g. Vikas Lifter)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="number" min={1} placeholder="Quantity" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input type="number" min={0} placeholder="Unit cost (₹)" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
      </div>
      {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          disabled={saving || !form.supplierName || !form.model || !form.unitCost}
          onClick={submit}
          className="rounded-[var(--radius)] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Create purchase order"}
        </button>
      </div>
    </div>
  );
}
