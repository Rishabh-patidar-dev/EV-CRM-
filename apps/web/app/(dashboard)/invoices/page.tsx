"use client";

// ============================================================================
// Invoices
// ============================================================================
// Route: /invoices
// One "Invoices" module covering every invoice the business touches, split
// into two tabs because the two sources are genuinely different shapes, not
// because they're different modules:
//
//  - Manufacturer Invoices: documents Order Management has handed a dealer
//    (Invoice model). Three types are generated automatically, following the
//    OEM's own order-placement flow chart: CONFIRMATION (stock available),
//    OUT_OF_STOCK (nothing to offer, expected renewal date), PARTIAL (stock
//    is close — limited quantity offered now, e.g. 150 of 155 requested).
//    CANCELLATION and CUSTOM are staff-authored via "Create invoice" — an
//    ad-hoc document to any dealer, not tied to a specific order.
//
//  - Dealer Purchase Invoices: read-only — dealers log these themselves
//    through the DMS portal (OCR-assisted intake, see
//    dealerPortal.controller.ts#createPurchaseInvoice). No approval/dispute
//    workflow here, just visibility into what each dealer has logged.
//
// Previously these were two separate sidebar entries/pages
// (/order-management/invoices and /purchase-management/dealer-invoices);
// merged here under one nav item at the product owner's request — "we get
// every invoice we have, don't separate invoices and dealer purchase
// invoices, they are one."
// ============================================================================
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2, FileText, Eye, Download, CheckCircle2, AlertTriangle, PackageMinus,
  XCircle, MessageSquare, Plus, RefreshCw, Truck, PackageCheck, Search,
  Receipt, IndianRupee, Scan,
} from "lucide-react";
import apiClient from "@/lib/api/client";
import Modal from "@/components/ui/Modal";
import { StatCard } from "@/components/ui/StatCard";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useDeepLinkQuery } from "@/lib/useDeepLinkQuery";
import { InvoiceCard } from "@/components/invoices/InvoiceCard";
import { downloadInvoicePdf, type InvoiceDealer, type InvoiceType } from "@/lib/invoicePdf";
import { INVOICE_LAST_SEEN_KEY } from "@/components/invoicesSeen";

// ----------------------------------------------------------------------------
// Manufacturer invoices (Invoice model)
// ----------------------------------------------------------------------------

interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  orderKind: "VEHICLE" | "SPARE_PART" | null;
  dealer: InvoiceDealer | null;
  type: InvoiceType;
  item: string;
  requestedQuantity: number | null;
  fulfilledQuantity: number | null;
  unitPrice: number | string | null;
  totalAmount: number | string | null;
  expectedRestockDate: string | null;
  message: string | null;
  issuedAt: string;
}

interface DealerOption {
  id: number;
  legalName: string;
  tradeName: string | null;
}

const TYPE_META: Record<InvoiceType, { label: string; icon: typeof FileText }> = {
  CONFIRMATION: { label: "Order confirmed", icon: CheckCircle2 },
  DISPATCH: { label: "Order dispatched", icon: Truck },
  DELIVERY: { label: "Order delivered", icon: PackageCheck },
  PARTIAL: { label: "Partial fulfillment", icon: PackageMinus },
  OUT_OF_STOCK: { label: "Out of stock", icon: AlertTriangle },
  CANCELLATION: { label: "Order cancellation", icon: XCircle },
  CUSTOM: { label: "General notice", icon: MessageSquare },
};

function invoiceTypeTone(type: InvoiceType): BadgeTone {
  if (type === "CONFIRMATION" || type === "DISPATCH" || type === "DELIVERY") return "approved";
  if (type === "OUT_OF_STOCK" || type === "CANCELLATION") return "rejected";
  return "pending"; // PARTIAL, CUSTOM
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// ----------------------------------------------------------------------------
// Dealer purchase invoices (DealerPurchaseInvoice model, read-only)
// ----------------------------------------------------------------------------

interface DealerInvoice {
  id: number;
  vendorName: string;
  vendorGstin: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  amount: string;
  category: string;
  notes: string | null;
  fileUrl: string | null;
  ocrExtractedText: string | null;
  ocrStatus: string | null;
  createdAt: string;
  dealer: { id: number; dealerCode: string; legalName: string };
}

const CATEGORY_TONE: Record<string, BadgeTone> = {
  VEHICLE_STOCK: "neutral",
  SPARE_PARTS: "info",
  OTHER: "neutral",
};

function resolveUrl(fileUrl: string) {
  if (fileUrl.startsWith("http")) return fileUrl;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${base}${fileUrl}`;
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

type Tab = "manufacturer" | "dealer-purchase";

export default function InvoicesPage() {
  const deepLinkQ = useDeepLinkQuery();

  // Which tab, and an optional dealer to pre-filter the dealer-purchase tab
  // by — read once on mount (no useSearchParams, so no Suspense boundary
  // needed here), same pattern as Order Management's ?tab= handling.
  const [initialDealerId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("dealerId") ?? "";
  });
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "manufacturer";
    const params = new URLSearchParams(window.location.search);
    if (params.get("dealerId")) return "dealer-purchase";
    return params.get("tab") === "dealer-purchase" ? "dealer-purchase" : "manufacturer";
  });

  // Clears the sidebar's unread-invoices badge — Sidebar re-checks the
  // count on every route change, so everything issued up to this moment
  // no longer counts as unread the next time it does.
  useEffect(() => {
    try {
      localStorage.setItem(INVOICE_LAST_SEEN_KEY, new Date().toISOString());
    } catch {
      // localStorage unavailable (private mode etc.) — the badge just
      // won't clear locally, not worth surfacing an error for.
    }
  }, []);

  // ---- Manufacturer invoices state ----
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState(deepLinkQ);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<InvoiceRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params: Record<string, string> = {};
      if (typeFilter) params.type = typeFilter;
      const { data } = await apiClient.get("/api/v1/order-management/invoices", { params });
      setInvoices(data.invoices ?? []);
    } catch (error: any) {
      console.error("[InvoicesPage] failed to load invoices:", error);
      setInvoices([]);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load invoices. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => { load(); }, [load]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((i) => i.invoiceNumber.toLowerCase().includes(q) || i.item.toLowerCase().includes(q));
  }, [invoices, search]);

  // ---- Dealer purchase invoices state ----
  const [dealerInvoices, setDealerInvoices] = useState<DealerInvoice[]>([]);
  const [dealerLoading, setDealerLoading] = useState(true);
  const [dealerExpanded, setDealerExpanded] = useState<number | null>(null);
  const [dealerLoadError, setDealerLoadError] = useState<string | null>(null);
  const [dealerSearch, setDealerSearch] = useState(deepLinkQ);
  const [dealerIdFilter, setDealerIdFilter] = useState(initialDealerId);

  const loadDealerInvoices = useCallback(async () => {
    setDealerLoading(true);
    setDealerLoadError(null);
    try {
      const params: Record<string, string> = {};
      if (dealerIdFilter) params.dealerId = dealerIdFilter;
      const { data } = await apiClient.get("/api/v1/purchase-management/dealer-invoices", { params });
      setDealerInvoices(data.invoices ?? []);
    } catch (error: any) {
      console.error("[InvoicesPage] failed to load dealer purchase invoices:", error);
      setDealerInvoices([]);
      setDealerLoadError(error?.response?.data?.message || error?.message || "Could not load dealer invoices. Try refreshing.");
    } finally {
      setDealerLoading(false);
    }
  }, [dealerIdFilter]);

  useEffect(() => { loadDealerInvoices(); }, [loadDealerInvoices]);

  const dealerTotalAmount = dealerInvoices.reduce((sum, i) => sum + Number(i.amount), 0);
  const dealerScannedCount = dealerInvoices.filter((i) => i.ocrStatus === "DONE").length;
  const dealerCount = new Set(dealerInvoices.map((i) => i.dealer.id)).size;

  const filteredDealerInvoices = useMemo(() => {
    const q = dealerSearch.trim().toLowerCase();
    if (!q) return dealerInvoices;
    return dealerInvoices.filter((i) => i.invoiceNumber.toLowerCase().includes(q) || i.vendorName.toLowerCase().includes(q) || i.dealer.legalName.toLowerCase().includes(q));
  }, [dealerInvoices, dealerSearch]);

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
            <p className="mt-1 text-sm text-muted-foreground">Every invoice the business touches — documents sent to dealers, and purchase invoices dealers have logged.</p>
          </div>
        </div>
      </header>

      {/* Tab switcher — one Invoices module, two shapes of data */}
      <div className="mb-6 inline-flex items-center gap-1 rounded-[var(--radius)] border border-border bg-card p-1">
        <button
          onClick={() => setTab("manufacturer")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "manufacturer" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <FileText className="h-3.5 w-3.5" /> Manufacturer Invoices
        </button>
        <button
          onClick={() => setTab("dealer-purchase")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "dealer-purchase" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Receipt className="h-3.5 w-3.5" /> Dealer Purchase Invoices
        </button>
      </div>

      {tab === "manufacturer" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Every document sent to a dealer — order-driven confirmations plus anything staff send directly.</p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search invoice # or item…"
                  className="w-56 rounded-[var(--radius)] border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
                <option value="">All types</option>
                <option value="CONFIRMATION">Order confirmed</option>
                <option value="DISPATCH">Order dispatched</option>
                <option value="DELIVERY">Order delivered</option>
                <option value="PARTIAL">Partial fulfillment</option>
                <option value="OUT_OF_STOCK">Out of stock</option>
                <option value="CANCELLATION">Order cancellation</option>
                <option value="CUSTOM">General notice</option>
              </select>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Create invoice
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Dealer</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Issued</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-[color:var(--zira-rejected)]">
                      {loadError}
                      <div className="mt-3">
                        <Button size="sm" variant="secondary" onClick={() => load()}>
                          <RefreshCw className="h-4 w-4" /> Retry
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : filteredInvoices.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">{invoices.length === 0 ? "No invoices issued yet." : "No invoices match your search."}</td></tr>
                ) : (
                  filteredInvoices.map((inv) => {
                    const meta = TYPE_META[inv.type];
                    const Icon = meta.icon;
                    const total = Number(inv.totalAmount ?? 0);
                    return (
                      <tr key={inv.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNumber}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1">
                            <Icon className="h-3 w-3" />
                            <Badge label={meta.label} tone={invoiceTypeTone(inv.type)} />
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {inv.dealer ? (
                            <Link href={`/dealer-management/${inv.dealer.id}`} className="hover:underline">{inv.dealer.tradeName || inv.dealer.legalName}</Link>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3">{inv.item}</td>
                        <td className="px-4 py-3 tabular-nums">
                          {inv.requestedQuantity != null || inv.fulfilledQuantity != null ? `${inv.fulfilledQuantity ?? "—"} / ${inv.requestedQuantity ?? "—"}` : "—"}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{total > 0 ? inr(total) : "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{new Date(inv.issuedAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => setViewing(inv)}>
                              <Eye className="h-3 w-3" /> View
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => downloadInvoicePdf(inv)}>
                              <Download className="h-3 w-3" /> PDF
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <CreateInvoiceModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />

          <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.invoiceNumber ?? "Invoice"} width="max-w-xl">
            {viewing && <InvoiceCard invoice={viewing} />}
          </Modal>
        </>
      )}

      {tab === "dealer-purchase" && (
        <>
          <p className="mb-6 text-sm text-muted-foreground">Read-only — every invoice a dealer has logged from the OEM or a spare-parts supplier, across the network.</p>

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={<Receipt className="h-4 w-4" />} label="Invoices logged" value={dealerInvoices.length} tone="teal" />
            <StatCard icon={<IndianRupee className="h-4 w-4" />} label="Total value" value={`₹${dealerTotalAmount.toLocaleString("en-IN")}`} tone="green" />
            <StatCard icon={<Scan className="h-4 w-4" />} label="OCR-scanned" value={dealerScannedCount} tone="blue" />
            <StatCard icon={<FileText className="h-4 w-4" />} label="Dealers" value={dealerCount} tone="purple" />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={dealerSearch}
                onChange={(e) => setDealerSearch(e.target.value)}
                placeholder="Search invoice #, vendor, dealer…"
                className="w-full rounded-[var(--radius)] border border-border bg-card py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {dealerIdFilter && (
              <Button size="sm" variant="secondary" onClick={() => setDealerIdFilter("")}>
                Clear dealer filter
              </Button>
            )}
          </div>

          <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Dealer</th>
                  <th className="px-4 py-3 font-medium">Vendor</th>
                  <th className="px-4 py-3 font-medium">Invoice #</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">File</th>
                </tr>
              </thead>
              <tbody>
                {dealerLoading ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
                ) : dealerLoadError ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[color:var(--zira-rejected)]">
                      {dealerLoadError}
                      <div className="mt-3">
                        <Button size="sm" variant="secondary" onClick={() => loadDealerInvoices()}>
                          <RefreshCw className="h-4 w-4" /> Retry
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : filteredDealerInvoices.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{dealerInvoices.length === 0 ? "No dealer has logged a purchase invoice yet." : "No invoices match your search."}</td></tr>
                ) : (
                  filteredDealerInvoices.map((inv) => (
                    <React.Fragment key={inv.id}>
                      <tr onClick={() => setDealerExpanded(dealerExpanded === inv.id ? null : inv.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50">
                        <td className="px-4 py-3">{inv.dealer.legalName}</td>
                        <td className="px-4 py-3">{inv.vendorName}</td>
                        <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNumber}</td>
                        <td className="px-4 py-3">{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                        <td className="px-4 py-3 tabular-nums">₹{Number(inv.amount).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3"><Badge status={inv.category} tone={CATEGORY_TONE[inv.category] ?? "neutral"} /></td>
                        <td className="px-4 py-3">
                          {inv.fileUrl ? (
                            <a href={resolveUrl(inv.fileUrl)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs font-medium text-primary hover:underline">View</a>
                          ) : "—"}
                        </td>
                      </tr>
                      {dealerExpanded === inv.id && (
                        <tr className="border-b border-border last:border-0">
                          <td colSpan={7} className="bg-muted/30 px-4 py-3">
                            {inv.notes && <p className="mb-1.5 text-sm">{inv.notes}</p>}
                            {inv.ocrExtractedText ? (
                              <div>
                                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">OCR-extracted text</p>
                                <pre className="whitespace-pre-wrap rounded-[var(--radius)] border border-border bg-background p-2 text-xs text-muted-foreground">{inv.ocrExtractedText}</pre>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">No OCR text available for this invoice.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const QUANTITY_TYPES: InvoiceType[] = ["CONFIRMATION", "DISPATCH", "DELIVERY", "OUT_OF_STOCK", "PARTIAL", "CANCELLATION"];
const RESTOCK_DATE_TYPES: InvoiceType[] = ["OUT_OF_STOCK", "PARTIAL", "CANCELLATION"];
const PRICED_TYPES: InvoiceType[] = ["CONFIRMATION", "DISPATCH", "DELIVERY", "PARTIAL"];

function CreateInvoiceModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [dealers, setDealers] = useState<DealerOption[]>([]);
  const [dealerId, setDealerId] = useState("");
  const [type, setType] = useState<InvoiceType>("CUSTOM");
  const [item, setItem] = useState("");
  const [message, setMessage] = useState("");
  const [requestedQuantity, setRequestedQuantity] = useState("");
  const [fulfilledQuantity, setFulfilledQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [expectedRestockDate, setExpectedRestockDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    apiClient.get("/api/v1/dealers", { params: { limit: 200 } }).then((res) => {
      setDealers(res.data.dealers ?? res.data.data ?? []);
    }).catch(() => {});
  }, [open]);

  function reset() {
    setDealerId("");
    setType("CUSTOM");
    setItem("");
    setMessage("");
    setRequestedQuantity("");
    setFulfilledQuantity("");
    setUnitPrice("");
    setExpectedRestockDate("");
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    if (!dealerId) return setError("Choose a dealer");
    if (!item.trim()) return setError("Enter a subject");

    setSubmitting(true);
    try {
      await apiClient.post("/api/v1/order-management/invoices", {
        dealerId,
        type,
        item: item.trim(),
        message: message.trim() || undefined,
        requestedQuantity: QUANTITY_TYPES.includes(type) && requestedQuantity ? requestedQuantity : undefined,
        fulfilledQuantity: QUANTITY_TYPES.includes(type) && fulfilledQuantity ? fulfilledQuantity : undefined,
        unitPrice: PRICED_TYPES.includes(type) && unitPrice ? unitPrice : undefined,
        expectedRestockDate: RESTOCK_DATE_TYPES.includes(type) && expectedRestockDate ? expectedRestockDate : undefined,
      });
      onCreated();
      reset();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not create the invoice.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Create invoice">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Send any dealer a document that isn't tied to a specific order — an order confirmation or cancellation you're issuing by hand, or any other dealership matter.
        </p>

        {error && (
          <div className="rounded-[var(--radius)] border px-3.5 py-2.5 text-sm" style={{ borderColor: "var(--destructive)", backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)", color: "var(--destructive)" }}>
            {error}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium">Dealer</label>
          <select value={dealerId} onChange={(e) => setDealerId(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
            <option value="">Select a dealer…</option>
            {dealers.map((d) => (
              <option key={d.id} value={d.id}>{d.tradeName || d.legalName}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as InvoiceType)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
            <option value="CONFIRMATION">Order confirmation</option>
            <option value="DISPATCH">Order dispatched</option>
            <option value="DELIVERY">Order delivered</option>
            <option value="CANCELLATION">Order cancellation</option>
            <option value="OUT_OF_STOCK">Out of stock notice</option>
            <option value="PARTIAL">Partial fulfillment</option>
            <option value="CUSTOM">General notice / dealership matter</option>
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Subject</label>
          <input
            value={item}
            onChange={(e) => setItem(e.target.value)}
            placeholder="e.g. Cancellation of STR-2026-000042, or Annual dealership agreement renewal"
            className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          />
        </div>

        {QUANTITY_TYPES.includes(type) && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Quantity (optional)</label>
              <input type="number" min={0} value={requestedQuantity} onChange={(e) => setRequestedQuantity(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Confirmed / fulfilled (optional)</label>
              <input type="number" min={0} value={fulfilledQuantity} onChange={(e) => setFulfilledQuantity(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
          </div>
        )}

        {PRICED_TYPES.includes(type) && (
          <div>
            <label className="mb-1.5 block text-sm font-medium">Unit price, ₹ (optional)</label>
            <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="Leave blank for ₹0" className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
        )}

        {RESTOCK_DATE_TYPES.includes(type) && (
          <div>
            <label className="mb-1.5 block text-sm font-medium">Expected date (optional)</label>
            <input type="date" value={expectedRestockDate} onChange={(e) => setExpectedRestockDate(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium">Message</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full">
          {submitting ? "Sending…" : "Send invoice"}
        </Button>
      </div>
    </Modal>
  );
}
