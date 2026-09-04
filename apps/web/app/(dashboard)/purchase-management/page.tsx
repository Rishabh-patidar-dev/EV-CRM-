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
//
// This page is the roll-up: every PO row drills through to
// /purchase-management/[id], where the receipt history (GRNs, scanned vendor
// bills, OCR text) actually lives. Every vendor row opens its edit modal.
// ============================================================================
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, PackageCheck, TrendingDown, Wallet, Plus, Loader2, Star, Ban, CheckCircle2, Truck, IndianRupee, RefreshCw, Search, Pencil, ChevronRight } from "lucide-react";
import apiClient from "@/lib/api/client";
import DonutChart from "@/components/charts/DonutChart";
import ChartCard from "@/components/charts/ChartCard";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import { useDeepLinkQuery } from "@/lib/useDeepLinkQuery";
import {
  CATEGORIES, PAYMENT_TONE, PO_STATUSES, SEGMENTS, STATUS_TONE,
  ReceiveGoodsModal, RecordPaymentModal, Stars,
  type PurchaseOrder, type Vendor,
} from "./shared";

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

export default function PurchaseManagementPage() {
  const router = useRouter();
  const deepLinkQ = useDeepLinkQuery();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState(deepLinkQ);
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);
  const [payingOrder, setPayingOrder] = useState<PurchaseOrder | null>(null);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);

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

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => o.poNumber.toLowerCase().includes(q) || o.supplierName.toLowerCase().includes(q) || o.model.toLowerCase().includes(q));
  }, [orders, search]);

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
        <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
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
                  <tr
                    key={v.id}
                    onClick={() => setEditingVendor(v)}
                    className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent"
                    title={`Edit ${v.name}`}
                  >
                    <td className="px-4 py-2.5 font-medium">{v.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{v.category.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2.5"><Stars rating={v.qualityRating} /></td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{v._count?.purchaseOrders ?? 0}</td>
                    <td className="px-4 py-2.5">
                      <Badge status={v.status} tone={v.status === "ACTIVE" ? "approved" : "rejected"} />
                      {v.status === "BLACKLISTED" && v.blacklistReason && <span className="ml-1.5 text-xs text-muted-foreground">— {v.blacklistReason}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="secondary" onClick={() => setEditingVendor(v)}>
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                      </div>
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
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PO #, supplier, model…"
            className="w-full rounded-[var(--radius)] border border-border bg-card py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {PO_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </section>

      {/* purchase order list */}
      <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
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
            ) : filteredOrders.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{orders.length === 0 ? "No purchase orders yet." : "No orders match your search."}</td></tr>
            ) : (
              filteredOrders.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => router.push(`/purchase-management/${o.id}`)}
                  className="group cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent"
                  title={`Open ${o.poNumber}`}
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 font-mono text-xs group-hover:text-primary group-hover:underline">
                      {o.poNumber}
                      <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                  </td>
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
                    {/* Row actions must not also drill through to the PO */}
                    <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
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
      {editingVendor && (
        <EditVendorModal
          vendor={editingVendor}
          onClose={() => setEditingVendor(null)}
          onDone={() => { setEditingVendor(null); refresh(); }}
        />
      )}
    </div>
  );
}

function NewVendorForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    name: "", category: "MISC", gstNumber: "", panNumber: "", isMsme: false,
    contactName: "", phone: "", email: "", address: "",
  });
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
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
        </select>
        <input placeholder="GST number" value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="PAN number" value={form.panNumber} onChange={(e) => setForm({ ...form, panNumber: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Contact name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm md:col-span-2" />
        <label className="flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" checked={form.isMsme} onChange={(e) => setForm({ ...form, isMsme: e.target.checked })} className="h-4 w-4 rounded border-border" />
          MSME registered
        </label>
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

// Vendor master edit — everything the PATCH accepts, plus blacklist /
// reactivate handled here with a real reason field (this replaces the
// window.prompt the row action used to raise).
function EditVendorModal({ vendor, onClose, onDone }: { vendor: Vendor; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: vendor.name,
    category: vendor.category,
    gstNumber: vendor.gstNumber ?? "",
    panNumber: vendor.panNumber ?? "",
    isMsme: !!vendor.isMsme,
    contactName: vendor.contactName ?? "",
    phone: vendor.phone ?? "",
    email: vendor.email ?? "",
    address: vendor.address ?? "",
  });
  const [blacklistReason, setBlacklistReason] = useState("");
  const [showBlacklist, setShowBlacklist] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Record<string, any>) => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.patch(`/api/v1/purchase-management/vendors/${vendor.id}`, body);
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not update vendor");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm";

  return (
    <Modal open onClose={onClose} title={`Vendor — ${vendor.name}`} width="max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          Quality rating <Stars rating={vendor.qualityRating} /> <span className="tabular-nums">{vendor.qualityRating}/5</span>
        </span>
        <span>·</span>
        <span>{vendor._count?.purchaseOrders ?? 0} purchase orders</span>
        <span>·</span>
        <Badge status={vendor.status} tone={vendor.status === "ACTIVE" ? "approved" : "rejected"} />
        <span className="ml-auto">Rating is system-managed — it moves with each goods receipt.</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Vendor name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputClass}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={form.isMsme} onChange={(e) => setForm({ ...form, isMsme: e.target.checked })} className="h-4 w-4 rounded border-border" />
            MSME registered
          </label>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">GST number</label>
          <input value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">PAN number</label>
          <input value={form.panNumber} onChange={(e) => setForm({ ...form, panNumber: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Contact name</label>
          <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Phone</label>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Address</label>
          <textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputClass} />
        </div>
      </div>

      {/* Blacklist / reactivate */}
      <div className="mt-4 border-t border-border pt-4">
        {vendor.status === "ACTIVE" ? (
          showBlacklist ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground">
                Reason for blacklisting {vendor.name} — required, and shown wherever this vendor appears
              </label>
              <textarea rows={2} value={blacklistReason} onChange={(e) => setBlacklistReason(e.target.value)} className={inputClass} placeholder="e.g. repeated quality failures on battery packs" />
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" disabled={saving || !blacklistReason.trim()} onClick={() => patch({ status: "BLACKLISTED", blacklistReason: blacklistReason.trim() })}>
                  <Ban className="h-3 w-3" /> Confirm blacklist
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowBlacklist(false)}>Never mind</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="destructive" onClick={() => setShowBlacklist(true)}>
              <Ban className="h-3 w-3" /> Blacklist vendor
            </Button>
          )
        ) : (
          <div className="space-y-2">
            {vendor.blacklistReason && <p className="text-xs text-muted-foreground">Blacklisted — {vendor.blacklistReason}</p>}
            <Button size="sm" variant="secondary" disabled={saving} onClick={() => patch({ status: "ACTIVE" })}>
              <CheckCircle2 className="h-3 w-3" /> Reactivate vendor
            </Button>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={saving || !form.name.trim()} onClick={() => patch(form)}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Modal>
  );
}

function NewPurchaseOrderForm({ vendors, onDone }: { vendors: Vendor[]; onDone: () => void }) {
  const [form, setForm] = useState<{ vendorId: number | string; model: string; segment: string; quantity: number; unitCost: string; expectedAt: string; notes: string }>({
    vendorId: vendors[0]?.id ?? "",
    model: "",
    segment: "L5",
    quantity: 1,
    unitCost: "",
    expectedAt: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post("/api/v1/purchase-management/orders", {
        ...form,
        expectedAt: form.expectedAt || undefined,
        notes: form.notes || undefined,
      });
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
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Expected delivery</label>
              <input type="date" value={form.expectedAt} onChange={(e) => setForm({ ...form, expectedAt: e.target.value })} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-4">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes</label>
              <input placeholder="Terms, delivery instructions, anything worth keeping on the order" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
            </div>
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
