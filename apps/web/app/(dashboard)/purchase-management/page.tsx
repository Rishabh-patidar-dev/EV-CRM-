"use client";

// ============================================================================
// SUBMODULE — Purchase & Vendor Management (manufacturer's own inbound stock)
// ============================================================================
// Route: /purchase-management
// Vendor master (Approved Vendor List, quality rating, blacklist) + purchase
// orders raised against a vendor + goods receipt (partial delivery, quality
// gate, auto-creates real VehicleUnit stock) + PO-level payment tracking.
// "Sold" figures are read directly from VehicleUnit.status = SOLD, the real
// sales record Vehicle Inventory already keeps.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import { ShoppingCart, PackageCheck, TrendingDown, Wallet, Plus, Loader2, Star, Ban, CheckCircle2, Truck, IndianRupee, RefreshCw } from "lucide-react";
import apiClient from "@/lib/api/client";
import DonutChart from "@/components/charts/DonutChart";
import ChartCard from "@/components/charts/ChartCard";
import { StatCard } from "@/components/ui/StatCard";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const SEGMENTS = ["L5", "L3", "CUSTOMISED"];
const CATEGORIES = ["BATTERY_PACK", "BMS", "MOTOR", "CONTROLLER", "CHASSIS", "BODY", "ELECTRICAL", "TYRES", "MISC"];
const PO_STATUSES = ["ORDERED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"];

interface Analytics {
  totalOrderedQty: number;
  totalReceivedQty: number;
  totalSold: number;
  netStockMovement: number;
  totalSpend: number;
  outstandingPayable: number;
  activeVendors: number;
  blacklistedVendors: number;
  avgVendorRating: number | null;
  importedByModel: { label: string; value: number }[];
  soldByModel: { label: string; value: number }[];
  poStatusBreakdown: { label: string; value: number }[];
  paymentStatusBreakdown: { label: string; value: number }[];
}

interface Vendor {
  id: number;
  name: string;
  category: string;
  qualityRating: number;
  status: "ACTIVE" | "BLACKLISTED";
  blacklistReason: string | null;
  _count?: { purchaseOrders: number };
}

interface PurchaseOrder {
  id: number;
  poNumber: string;
  supplierName: string;
  vendorId: number | null;
  vendor: { id: number; name: string; qualityRating: number; status: string } | null;
  model: string;
  segment: string;
  quantity: number;
  quantityReceived: number;
  unitCost: string;
  status: string;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  amountPaid: string;
  orderedAt: string;
  expectedAt: string | null;
  receivedAt: string | null;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  ORDERED: "pending",
  IN_TRANSIT: "pending",
  PARTIALLY_RECEIVED: "pending",
  RECEIVED: "approved",
  CANCELLED: "rejected",
};

const PAYMENT_TONE: Record<string, BadgeTone> = {
  UNPAID: "rejected",
  PARTIAL: "pending",
  PAID: "approved",
};

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${rating}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={`h-3 w-3 ${i < rating ? "fill-current text-[color:var(--zira-pending)]" : "text-muted-foreground/30"}`} />
      ))}
    </span>
  );
}

export default function PurchaseManagementPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);
  const [payingOrder, setPayingOrder] = useState<PurchaseOrder | null>(null);

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

  const loadVendors = useCallback(async () => {
    const { data } = await apiClient.get("/api/v1/purchase-management/vendors");
    setVendors(data.vendors ?? []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await Promise.all([loadAnalytics(), loadOrders(), loadVendors()]);
    } catch (error: any) {
      console.error("[PurchaseManagementPage] failed to refresh:", error);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load purchase management data. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [loadAnalytics, loadOrders, loadVendors]);

  useEffect(() => { refresh(); }, [refresh]);

  const advance = async (order: PurchaseOrder, status: string) => {
    await apiClient.patch(`/api/v1/purchase-management/orders/${order.id}`, { status });
    await refresh();
  };

  const blacklistVendor = async (vendor: Vendor) => {
    const reason = window.prompt(`Reason for blacklisting ${vendor.name}?`);
    if (!reason) return;
    await apiClient.patch(`/api/v1/purchase-management/vendors/${vendor.id}`, { status: "BLACKLISTED", blacklistReason: reason });
    await refresh();
  };

  const reactivateVendor = async (vendor: Vendor) => {
    await apiClient.patch(`/api/v1/purchase-management/vendors/${vendor.id}`, { status: "ACTIVE" });
    await refresh();
  };

  return (
    <div className="mx-auto max-w-[1600px] p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase & Vendor Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The manufacturer's own inbound stock — approved vendors, purchase orders, goods receipt, and payment.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowVendorForm((v) => !v)}>
            <Plus className="h-4 w-4" /> New vendor
          </Button>
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" /> New purchase order
          </Button>
        </div>
      </header>

      {loadError && (
        <div className="mb-6 rounded-[var(--radius)] border border-dashed border-[color:var(--zira-rejected)]/40 p-4 text-center text-[color:var(--zira-rejected)]">
          {loadError}
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      )}

      {/* KPI row */}
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={<ShoppingCart className="h-3.5 w-3.5" />} label="Total ordered" value={analytics?.totalOrderedQty ?? "—"} />
        <StatCard icon={<PackageCheck className="h-3.5 w-3.5" />} label="Received into stock" value={analytics?.totalReceivedQty ?? "—"} />
        <StatCard icon={<TrendingDown className="h-3.5 w-3.5" />} label="Sold" value={analytics?.totalSold ?? "—"} />
        <StatCard icon={<Wallet className="h-3.5 w-3.5" />} label="Outstanding payable" value={analytics ? `₹${analytics.outstandingPayable.toLocaleString("en-IN")}` : "—"} />
        <StatCard icon={<Star className="h-3.5 w-3.5" />} label="Avg vendor rating" value={analytics?.avgVendorRating != null ? `${analytics.avgVendorRating} / 5` : "—"} />
      </section>

      {/* BI dashboard */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard title="Imported by model" subtitle="Purchase orders received or partially received, by model">
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
        <ChartCard title="Payment status" subtitle="Non-cancelled purchase orders, by payment state">
          {analytics && analytics.paymentStatusBreakdown.length > 0 ? (
            <DonutChart data={analytics.paymentStatusBreakdown} centerLabel="orders" />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">No purchase orders yet.</p>
          )}
        </ChartCard>
      </section>

      {showVendorForm && <NewVendorForm onDone={() => { setShowVendorForm(false); refresh(); }} />}

      {/* Vendors — Approved Vendor List */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Approved Vendor List <span className="font-normal text-muted-foreground">({vendors.length})</span></h2>
        <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Vendor</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Quality rating</th>
                <th className="px-4 py-2.5 font-medium">POs</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {vendors.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No vendors yet — add one to raise purchase orders.</td></tr>
              ) : (
                vendors.map((v) => (
                  <tr key={v.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">{v.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{v.category.replace("_", " ")}</td>
                    <td className="px-4 py-2.5"><Stars rating={v.qualityRating} /></td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{v._count?.purchaseOrders ?? 0}</td>
                    <td className="px-4 py-2.5">
                      <Badge status={v.status} tone={v.status === "ACTIVE" ? "approved" : "rejected"} />
                      {v.status === "BLACKLISTED" && v.blacklistReason && <span className="ml-1.5 text-xs text-muted-foreground">— {v.blacklistReason}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {v.status === "ACTIVE" ? (
                        <Button size="sm" variant="secondary" onClick={() => blacklistVendor(v)}>
                          <Ban className="h-3 w-3" /> Blacklist
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => reactivateVendor(v)}>
                          <CheckCircle2 className="h-3 w-3" /> Reactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showForm && <NewPurchaseOrderForm vendors={vendors.filter((v) => v.status === "ACTIVE")} onDone={() => { setShowForm(false); refresh(); }} />}

      {/* filter */}
      <section className="mb-4 flex flex-wrap items-center gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {PO_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </section>

      {/* purchase order list */}
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">PO</th>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Model / qty</th>
              <th className="px-4 py-3 font-medium">Unit cost</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Payment</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No purchase orders yet.</td></tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{o.poNumber}</td>
                  <td className="px-4 py-3">
                    {o.supplierName}
                    {o.vendor && <span className="ml-1.5 inline-block align-middle"><Stars rating={o.vendor.qualityRating} /></span>}
                  </td>
                  <td className="px-4 py-3">
                    {o.model} × {o.quantity} <span className="text-muted-foreground">({o.segment})</span>
                    {o.quantityReceived > 0 && o.quantityReceived < o.quantity && (
                      <span className="ml-1.5 text-xs text-muted-foreground">— {o.quantityReceived} received</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">₹{Number(o.unitCost).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3"><Badge status={o.status} tone={STATUS_TONE[o.status] ?? "neutral"} /></td>
                  <td className="px-4 py-3"><Badge status={o.paymentStatus} tone={PAYMENT_TONE[o.paymentStatus] ?? "neutral"} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      {o.status === "ORDERED" && (
                        <Button size="sm" variant="secondary" onClick={() => advance(o, "IN_TRANSIT")}>
                          Mark in transit
                        </Button>
                      )}
                      {(o.status === "ORDERED" || o.status === "IN_TRANSIT" || o.status === "PARTIALLY_RECEIVED") && (
                        <Button size="sm" variant="secondary" onClick={() => setReceivingOrder(o)}>
                          <Truck className="h-3 w-3" /> Receive goods
                        </Button>
                      )}
                      {o.paymentStatus !== "PAID" && o.status !== "CANCELLED" && (
                        <Button size="sm" variant="secondary" onClick={() => setPayingOrder(o)}>
                          <IndianRupee className="h-3 w-3" /> Pay
                        </Button>
                      )}
                      {(o.status === "ORDERED" || o.status === "IN_TRANSIT") && (
                        <Button size="sm" variant="secondary" onClick={() => advance(o, "CANCELLED")}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {receivingOrder && (
        <ReceiveGoodsModal
          order={receivingOrder}
          onClose={() => setReceivingOrder(null)}
          onDone={() => { setReceivingOrder(null); refresh(); }}
        />
      )}
      {payingOrder && (
        <RecordPaymentModal
          order={payingOrder}
          onClose={() => setPayingOrder(null)}
          onDone={() => { setPayingOrder(null); refresh(); }}
        />
      )}
    </div>
  );
}

function NewVendorForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: "", category: "MISC", gstNumber: "", contactName: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post("/api/v1/purchase-management/vendors", form);
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not create vendor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="compact" className="mb-6">
      <h3 className="mb-3 text-sm font-semibold">New vendor</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <input placeholder="Vendor / supplier name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
        </select>
        <input placeholder="GST number" value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Contact name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
      </div>
      {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={saving || !form.name} onClick={submit}>
          {saving ? "Saving…" : "Create vendor"}
        </Button>
      </div>
    </Card>
  );
}

function NewPurchaseOrderForm({ vendors, onDone }: { vendors: Vendor[]; onDone: () => void }) {
  const [form, setForm] = useState<{ vendorId: number | string; model: string; segment: string; quantity: number; unitCost: string; expectedAt: string }>({
    vendorId: vendors[0]?.id ?? "",
    model: "",
    segment: "L5",
    quantity: 1,
    unitCost: "",
    expectedAt: "",
  });
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
    <Card padding="compact" className="mb-6">
      <h3 className="mb-3 text-sm font-semibold">New purchase order</h3>
      {vendors.length === 0 ? (
        <p className="text-xs text-muted-foreground">Add an active vendor first — purchase orders must be raised against one.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <select value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input placeholder="Model (e.g. Vikas Lifter)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
            <select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
              {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="number" min={1} placeholder="Quantity" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
            <input type="number" min={0} placeholder="Unit cost (₹)" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
          </div>
          {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={saving || !form.model || !form.unitCost} onClick={submit}>
              {saving ? "Saving…" : "Create purchase order"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function ReceiveGoodsModal({ order, onClose, onDone }: { order: PurchaseOrder; onClose: () => void; onDone: () => void }) {
  const remaining = order.quantity - order.quantityReceived;
  const [quantityReceived, setQuantityReceived] = useState(remaining);
  const [qualityResult, setQualityResult] = useState("PASS");
  const [rejectionReason, setRejectionReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post(`/api/v1/purchase-management/orders/${order.id}/receive`, {
        quantityReceived,
        qualityResult,
        rejectionReason: qualityResult === "REJECT" ? rejectionReason : undefined,
      });
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not record receipt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-sm">
        <h3 className="mb-1 text-sm font-semibold">Receive goods — {order.poNumber}</h3>
        <p className="mb-3 text-xs text-muted-foreground">{order.model} · {remaining} of {order.quantity} still outstanding</p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Quantity received</label>
            <input type="number" min={1} max={remaining} value={quantityReceived} onChange={(e) => setQuantityReceived(Math.min(remaining, Math.max(1, parseInt(e.target.value) || 1)))} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Quality check</label>
            <select value={qualityResult} onChange={(e) => setQualityResult(e.target.value)} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
              <option value="PASS">Pass — accept into stock</option>
              <option value="PARTIAL_ACCEPT">Partial accept — accept with note</option>
              <option value="REJECT">Reject — does not enter stock</option>
            </select>
          </div>
          {qualityResult === "REJECT" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Rejection reason</label>
              <input value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" placeholder="e.g. damaged in transit" />
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving || (qualityResult === "REJECT" && !rejectionReason)} onClick={submit}>
            {saving ? "Recording…" : "Record GRN"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function RecordPaymentModal({ order, onClose, onDone }: { order: PurchaseOrder; onClose: () => void; onDone: () => void }) {
  const total = order.quantity * Number(order.unitCost);
  const outstanding = total - Number(order.amountPaid);
  const [amount, setAmount] = useState(outstanding);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post(`/api/v1/purchase-management/orders/${order.id}/payment`, { amount });
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not record payment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-sm">
        <h3 className="mb-1 text-sm font-semibold">Record payment — {order.poNumber}</h3>
        <p className="mb-3 text-xs text-muted-foreground">₹{Number(order.amountPaid).toLocaleString("en-IN")} paid of ₹{total.toLocaleString("en-IN")} · ₹{outstanding.toLocaleString("en-IN")} outstanding</p>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Amount (₹)</label>
        <input type="number" min={1} max={outstanding} value={amount} onChange={(e) => setAmount(Math.min(outstanding, Math.max(1, Number(e.target.value) || 1)))} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={submit}>
            {saving ? "Recording…" : "Record payment"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
