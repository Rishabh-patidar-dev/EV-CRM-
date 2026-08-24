"use client";

// ============================================================================
// Invoices
// ============================================================================
// Route: /order-management/invoices
// Every document Order Management has handed a dealer. Three types are
// generated automatically, following the OEM's own order-placement flow
// chart: CONFIRMATION (stock available), OUT_OF_STOCK (nothing to offer,
// expected renewal date), PARTIAL (stock is close — limited quantity offered
// now, e.g. 150 of 155 requested). CANCELLATION and CUSTOM are staff-
// authored via "Create invoice" — an ad-hoc document to any dealer, not tied
// to a specific order (an order cancellation notice, a dealership matter,
// anything else).
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, FileText, Printer, CheckCircle2, AlertTriangle, PackageMinus, XCircle, MessageSquare, Plus, RefreshCw } from "lucide-react";
import apiClient from "@/lib/api/client";
import Modal from "@/components/ui/Modal";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type InvoiceType = "CONFIRMATION" | "OUT_OF_STOCK" | "PARTIAL" | "CANCELLATION" | "CUSTOM";

interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  orderKind: "VEHICLE" | "SPARE_PART" | null;
  dealer: { id: number; dealerCode: string; legalName: string; tradeName: string | null; state: string } | null;
  type: InvoiceType;
  item: string;
  requestedQuantity: number | null;
  fulfilledQuantity: number | null;
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
  PARTIAL: { label: "Partial fulfillment", icon: PackageMinus },
  OUT_OF_STOCK: { label: "Out of stock", icon: AlertTriangle },
  CANCELLATION: { label: "Order cancellation", icon: XCircle },
  CUSTOM: { label: "General notice", icon: MessageSquare },
};

function invoiceTypeTone(type: InvoiceType): BadgeTone {
  if (type === "CONFIRMATION") return "approved";
  if (type === "OUT_OF_STOCK" || type === "CANCELLATION") return "rejected";
  return "pending"; // PARTIAL, CUSTOM
}

function printInvoice(inv: InvoiceRow) {
  const w = window.open("", "_blank", "width=640,height=760");
  if (!w) return;
  const meta = TYPE_META[inv.type];
  const restock = inv.expectedRestockDate
    ? new Date(inv.expectedRestockDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;
  const hasQty = inv.requestedQuantity != null || inv.fulfilledQuantity != null;
  w.document.write(`<!doctype html><html><head><title>${inv.invoiceNumber}</title>
    <style>
      body{font-family:ui-sans-serif,system-ui,sans-serif;color:#1c1c1a;padding:40px;max-width:560px;margin:0 auto}
      h1{font-size:18px;margin:0 0 4px}
      .muted{color:#6b6a63;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:24px}
      td{padding:8px 0;border-bottom:1px solid #eceae4;font-size:13px}
      td:first-child{color:#6b6a63;width:45%}
      .msg{margin-top:20px;padding:14px;background:#f4f3ee;border-radius:8px;font-size:13px;line-height:1.5}
      .foot{margin-top:32px;font-size:11px;color:#9a988f}
    </style></head><body>
    <h1>${meta.label}</h1>
    <div class="muted">${inv.invoiceNumber} · issued ${new Date(inv.issuedAt).toLocaleDateString()}</div>
    <table>
      <tr><td>Dealer</td><td>${inv.dealer ? (inv.dealer.tradeName || inv.dealer.legalName) : "—"}</td></tr>
      <tr><td>Subject</td><td>${inv.item}</td></tr>
      ${inv.requestedQuantity != null ? `<tr><td>Requested quantity</td><td>${inv.requestedQuantity}</td></tr>` : ""}
      ${inv.fulfilledQuantity != null ? `<tr><td>${inv.type === "CONFIRMATION" ? "Confirmed quantity" : "Fulfilled now"}</td><td>${inv.fulfilledQuantity}</td></tr>` : ""}
      ${restock ? `<tr><td>Expected date</td><td>${restock}</td></tr>` : ""}
    </table>
    ${inv.message ? `<div class="msg">${inv.message}</div>` : ""}
    <div class="foot">Issued by Order Management — Luxus Green Mobility.</div>
    <script>window.onload = () => window.print()</script>
    </body></html>`);
  w.document.close();
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  return (
    <div className="mx-auto max-w-[1300px] p-6">
      <Link href="/order-management" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Order Management
      </Link>

      <header className="mb-6 mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
            <p className="mt-1 text-sm text-muted-foreground">Every document sent to a dealer — order-driven confirmations plus anything staff send directly.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
            <option value="">All types</option>
            <option value="CONFIRMATION">Order confirmed</option>
            <option value="PARTIAL">Partial fulfillment</option>
            <option value="OUT_OF_STOCK">Out of stock</option>
            <option value="CANCELLATION">Order cancellation</option>
            <option value="CUSTOM">General notice</option>
          </select>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Create invoice
          </Button>
        </div>
      </header>

      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Issued</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : loadError ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[color:var(--zira-rejected)]">
                  {loadError}
                  <div className="mt-3">
                    <Button size="sm" variant="secondary" onClick={() => load()}>
                      <RefreshCw className="h-4 w-4" /> Retry
                    </Button>
                  </div>
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No invoices issued yet.</td></tr>
            ) : (
              invoices.map((inv) => {
                const meta = TYPE_META[inv.type];
                const Icon = meta.icon;
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
                    <td className="px-4 py-3 text-muted-foreground">{new Date(inv.issuedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => printInvoice(inv)}>
                        <Printer className="h-3 w-3" /> View / print
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <CreateInvoiceModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
    </div>
  );
}

const QUANTITY_TYPES: InvoiceType[] = ["CONFIRMATION", "OUT_OF_STOCK", "PARTIAL", "CANCELLATION"];
const RESTOCK_DATE_TYPES: InvoiceType[] = ["OUT_OF_STOCK", "PARTIAL", "CANCELLATION"];

function CreateInvoiceModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [dealers, setDealers] = useState<DealerOption[]>([]);
  const [dealerId, setDealerId] = useState("");
  const [type, setType] = useState<InvoiceType>("CUSTOM");
  const [item, setItem] = useState("");
  const [message, setMessage] = useState("");
  const [requestedQuantity, setRequestedQuantity] = useState("");
  const [fulfilledQuantity, setFulfilledQuantity] = useState("");
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
