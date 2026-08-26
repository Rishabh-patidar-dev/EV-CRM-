"use client";

// ============================================================================
// Invoices
// ============================================================================
// Route: /invoices
// One "Invoices" module, one list — an invoice is an invoice regardless of
// which side wrote it, so manufacturer-issued documents (Invoice model) and
// dealer-logged purchase bills (DealerPurchaseInvoice model, read-only —
// dealers log these themselves through the DMS portal, no approval/dispute
// workflow) are shown together, sorted by date, not split behind a tab.
//
// Previously these were two separate sidebar entries/pages
// (/order-management/invoices and /purchase-management/dealer-invoices);
// merged here under one nav item at the product owner's request — "we get
// every invoice we have, don't separate invoices and dealer purchase
// invoices, they are one" — later tightened further to "there is no
// difference between them... invoices are just invoices" (remove the tab
// switch too, one combined list).
// ============================================================================
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2, FileText, Eye, Download, Plus, RefreshCw, Search, Receipt, IndianRupee, Scan,
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

const TYPE_LABEL: Record<InvoiceType, string> = {
  CONFIRMATION: "Order confirmed",
  DISPATCH: "Order dispatched",
  DELIVERY: "Order delivered",
  PARTIAL: "Partial fulfillment",
  OUT_OF_STOCK: "Out of stock",
  CANCELLATION: "Order cancellation",
  CUSTOM: "General notice",
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

function resolveUrl(fileUrl: string) {
  if (fileUrl.startsWith("http")) return fileUrl;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${base}${fileUrl}`;
}

// ----------------------------------------------------------------------------
// One normalized row shape for both sources — this is what actually makes
// them "just invoices" instead of two separate tables.
// ----------------------------------------------------------------------------

type Row = {
  key: string;
  date: string;
  number: string;
  dealer: { id: number; label: string } | null;
  party: string; // "Manufacturer" for OEM docs, vendor name for purchase bills
  subject: string;
  amount: number | null;
  typeLabel: string;
  tone: BadgeTone;
  onView: () => void;
  onDownload?: () => void;
};

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export default function InvoicesPage() {
  const deepLinkQ = useDeepLinkQuery();

  const [initialDealerId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("dealerId") ?? "";
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
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<InvoiceRow | null>(null);
  const [viewingDealer, setViewingDealer] = useState<DealerInvoice | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await apiClient.get("/api/v1/order-management/invoices");
      setInvoices(data.invoices ?? []);
    } catch (error: any) {
      console.error("[InvoicesPage] failed to load invoices:", error);
      setInvoices([]);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load invoices. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ---- Dealer purchase invoices state ----
  const [dealerInvoices, setDealerInvoices] = useState<DealerInvoice[]>([]);
  const [dealerLoading, setDealerLoading] = useState(true);
  const [dealerLoadError, setDealerLoadError] = useState<string | null>(null);
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

  // ---- Combined ----
  const rows: Row[] = useMemo(() => {
    const fromInvoices: Row[] = invoices.map((inv) => ({
      key: `inv-${inv.id}`,
      date: inv.issuedAt,
      number: inv.invoiceNumber,
      dealer: inv.dealer ? { id: inv.dealer.id, label: inv.dealer.tradeName || inv.dealer.legalName } : null,
      party: "Manufacturer",
      subject: inv.item,
      amount: inv.totalAmount != null ? Number(inv.totalAmount) : null,
      typeLabel: TYPE_LABEL[inv.type] ?? inv.type,
      tone: invoiceTypeTone(inv.type),
      onView: () => setViewing(inv),
      onDownload: () => downloadInvoicePdf(inv),
    }));
    const fromDealers: Row[] = dealerInvoices.map((d) => ({
      key: `dlr-${d.id}`,
      date: d.invoiceDate,
      number: d.invoiceNumber,
      dealer: { id: d.dealer.id, label: d.dealer.legalName },
      party: d.vendorName,
      subject: `Purchase — ${d.category.replace(/_/g, " ").toLowerCase()}`,
      amount: Number(d.amount),
      typeLabel: "Purchase",
      tone: "neutral" as BadgeTone,
      onView: () => setViewingDealer(d),
    }));
    return [...fromInvoices, ...fromDealers].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, dealerInvoices]);

  const [search, setSearch] = useState(deepLinkQ);
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.number.toLowerCase().includes(q) || r.subject.toLowerCase().includes(q) || r.party.toLowerCase().includes(q) || (r.dealer?.label.toLowerCase().includes(q) ?? false));
  }, [rows, search]);

  const totalValue = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const scannedCount = dealerInvoices.filter((i) => i.ocrStatus === "DONE").length;
  const anyLoading = loading || dealerLoading;
  const anyError = loadError || dealerLoadError;

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

      {anyError && (
        <div className="mb-4 rounded-[var(--radius)] border px-4 py-3 text-sm" style={{ borderColor: "var(--zira-rejected)", color: "var(--zira-rejected)" }}>
          {loadError || dealerLoadError}
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => { load(); loadDealerInvoices(); }}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Receipt className="h-4 w-4" />} label="Total invoices" value={rows.length} tone="teal" />
        <StatCard icon={<IndianRupee className="h-4 w-4" />} label="Total value" value={inr(totalValue)} tone="green" />
        <StatCard icon={<Scan className="h-4 w-4" />} label="Purchase bills scanned" value={scannedCount} tone="blue" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice #, dealer, vendor, subject…"
            className="w-full rounded-[var(--radius)] border border-border bg-card py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {dealerIdFilter && (
          <Button size="sm" variant="secondary" onClick={() => setDealerIdFilter("")}>
            Clear dealer filter
          </Button>
        )}
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create invoice
        </Button>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">From</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {anyLoading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">{rows.length === 0 ? "No invoices yet." : "No invoices match your search."}</td></tr>
            ) : (
              filteredRows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{r.number}</td>
                  <td className="px-4 py-3"><Badge label={r.typeLabel} tone={r.tone} /></td>
                  <td className="px-4 py-3">
                    {r.dealer ? (
                      <Link href={`/dealer-management/${r.dealer.id}`} className="hover:underline">{r.dealer.label}</Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3">{r.party}</td>
                  <td className="px-4 py-3">{r.subject}</td>
                  <td className="px-4 py-3 tabular-nums">{r.amount ? inr(r.amount) : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(r.date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="secondary" onClick={r.onView}>
                        <Eye className="h-3 w-3" /> View
                      </Button>
                      {r.onDownload && (
                        <Button size="sm" variant="secondary" onClick={r.onDownload}>
                          <Download className="h-3 w-3" /> PDF
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

      <CreateInvoiceModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.invoiceNumber ?? "Invoice"} width="max-w-xl">
        {viewing && <InvoiceCard invoice={viewing} />}
      </Modal>

      <Modal open={!!viewingDealer} onClose={() => setViewingDealer(null)} title={viewingDealer?.invoiceNumber ?? "Purchase invoice"} width="max-w-xl">
        {viewingDealer && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Dealer</span><span>{viewingDealer.dealer.legalName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span>{viewingDealer.vendorName}</span></div>
            {viewingDealer.vendorGstin && <div className="flex justify-between"><span className="text-muted-foreground">Vendor GSTIN</span><span>{viewingDealer.vendorGstin}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span>{new Date(viewingDealer.invoiceDate).toLocaleDateString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span>{inr(Number(viewingDealer.amount))}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span>{viewingDealer.category.replace(/_/g, " ")}</span></div>
            {viewingDealer.notes && <p className="rounded-[var(--radius)] border border-border bg-muted/30 p-3">{viewingDealer.notes}</p>}
            {viewingDealer.fileUrl && (
              <a href={resolveUrl(viewingDealer.fileUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                <FileText className="h-4 w-4" /> View uploaded file
              </a>
            )}
            {viewingDealer.ocrExtractedText && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">OCR-extracted text</p>
                <pre className="whitespace-pre-wrap rounded-[var(--radius)] border border-border bg-background p-2 text-xs text-muted-foreground">{viewingDealer.ocrExtractedText}</pre>
              </div>
            )}
          </div>
        )}
      </Modal>
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
