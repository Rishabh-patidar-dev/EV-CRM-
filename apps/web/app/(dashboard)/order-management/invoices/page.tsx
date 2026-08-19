"use client";

// ============================================================================
// Invoices
// ============================================================================
// Route: /order-management/invoices
// Every document Order Management has actually handed a dealer, following
// the OEM's own order-placement flow chart: CONFIRMATION (stock available),
// OUT_OF_STOCK (nothing to offer, expected renewal date), or PARTIAL (stock
// is close — limited quantity offered now, e.g. 150 of 155 requested).
// These are generated automatically by Check Inventory / Disputed Orders —
// this page is the read-only record of what was issued and when.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, FileText, Printer, CheckCircle2, AlertTriangle, PackageMinus } from "lucide-react";
import apiClient from "@/lib/api/client";

interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  orderKind: "VEHICLE" | "SPARE_PART";
  dealer: { id: number; dealerCode: string; legalName: string; tradeName: string | null; state: string } | null;
  type: "CONFIRMATION" | "OUT_OF_STOCK" | "PARTIAL";
  item: string;
  requestedQuantity: number;
  fulfilledQuantity: number;
  expectedRestockDate: string | null;
  message: string | null;
  issuedAt: string;
}

const TYPE_META: Record<InvoiceRow["type"], { label: string; icon: typeof FileText; badge: string }> = {
  CONFIRMATION: { label: "Order confirmed", icon: CheckCircle2, badge: "badge-approved" },
  PARTIAL: { label: "Partial fulfillment", icon: PackageMinus, badge: "badge-pending" },
  OUT_OF_STOCK: { label: "Out of stock", icon: AlertTriangle, badge: "badge-rejected" },
};

function printInvoice(inv: InvoiceRow) {
  const w = window.open("", "_blank", "width=640,height=760");
  if (!w) return;
  const meta = TYPE_META[inv.type];
  const restock = inv.expectedRestockDate
    ? new Date(inv.expectedRestockDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;
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
      <tr><td>Item</td><td>${inv.item}</td></tr>
      <tr><td>Requested quantity</td><td>${inv.requestedQuantity}</td></tr>
      <tr><td>${inv.type === "CONFIRMATION" ? "Confirmed quantity" : "Fulfilled now"}</td><td>${inv.fulfilledQuantity}</td></tr>
      ${restock ? `<tr><td>Expected date for order renewal</td><td>${restock}</td></tr>` : ""}
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

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (typeFilter) params.type = typeFilter;
    const { data } = await apiClient.get("/api/v1/order-management/invoices", { params });
    setInvoices(data.invoices ?? []);
    setLoading(false);
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
            <p className="mt-1 text-sm text-muted-foreground">Every confirmation, out-of-stock, and partial-fulfillment document sent to a dealer.</p>
          </div>
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All types</option>
          <option value="CONFIRMATION">Order confirmed</option>
          <option value="PARTIAL">Partial fulfillment</option>
          <option value="OUT_OF_STOCK">Out of stock</option>
        </select>
      </header>

      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Issued</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
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
                      <span className={`${meta.badge} inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs`}>
                        <Icon className="h-3 w-3" /> {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {inv.dealer ? (
                        <Link href={`/dealer-management/${inv.dealer.id}`} className="hover:underline">{inv.dealer.tradeName || inv.dealer.legalName}</Link>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">{inv.item}</td>
                    <td className="px-4 py-3 tabular-nums">{inv.fulfilledQuantity} / {inv.requestedQuantity}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(inv.issuedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => printInvoice(inv)}
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                      >
                        <Printer className="h-3 w-3" /> View / print
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
