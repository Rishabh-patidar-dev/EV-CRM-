"use client";

// ============================================================================
// InvoiceCard
// ============================================================================
// The "informative card" view of an Invoice — same data as the downloadable
// PDF (lib/invoicePdf.ts), laid out for on-screen reading rather than print.
// Used inside a Modal from the Invoices list ("View") and reusable anywhere
// else an invoice needs to be shown inline.
// ============================================================================
import React from "react";
import { Download, Mail, Phone, Building2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { downloadInvoicePdf, type InvoiceDoc, type InvoiceType } from "@/lib/invoicePdf";

const TYPE_LABEL: Record<InvoiceType, string> = {
  CONFIRMATION: "Order Confirmation",
  DISPATCH: "Dispatch Note",
  DELIVERY: "Delivery Receipt",
  PARTIAL: "Partial Fulfillment",
  OUT_OF_STOCK: "Out of Stock",
  CANCELLATION: "Order Cancellation",
  CUSTOM: "General Notice",
};

function typeTone(type: InvoiceType): BadgeTone {
  if (type === "CONFIRMATION" || type === "DISPATCH" || type === "DELIVERY") return "approved";
  if (type === "OUT_OF_STOCK" || type === "CANCELLATION") return "rejected";
  return "pending";
}

const PRICED_TYPES = new Set<InvoiceType>(["CONFIRMATION", "DISPATCH", "DELIVERY", "PARTIAL"]);
const GST_RATE = 0.18;
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function InvoiceCard({ invoice }: { invoice: InvoiceDoc }) {
  const priced = PRICED_TYPES.has(invoice.type);
  const qty = invoice.fulfilledQuantity ?? invoice.requestedQuantity ?? 0;
  const unitPrice = Number(invoice.unitPrice ?? 0);
  const subtotal = priced ? unitPrice * qty : 0;
  const gst = subtotal * GST_RATE;
  const total = subtotal + gst;
  const d = invoice.dealer;

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/30 p-5">
        <div>
          <div className="text-lg font-semibold tracking-tight">Luxus Green Mobility</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Electric Vehicles · Manufacturer &amp; OEM</div>
        </div>
        <div className="text-right">
          <Badge label={TYPE_LABEL[invoice.type]} tone={typeTone(invoice.type)} />
          <div className="mt-1.5 font-mono text-xs text-muted-foreground">{invoice.invoiceNumber}</div>
          <div className="text-xs text-muted-foreground">{new Date(invoice.issuedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</div>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Bill to</div>
          {d ? (
            <div className="mt-1.5 space-y-0.5 text-sm">
              <div className="flex items-center gap-1.5 font-medium"><Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {d.tradeName || d.legalName}</div>
              <div className="text-xs text-muted-foreground">{d.dealerCode} · {d.state}</div>
              {d.phone && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3" /> {d.phone}</div>}
              {d.email && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="h-3 w-3" /> {d.email}</div>}
              {d.gstNumber && <div className="text-xs text-muted-foreground">GSTIN {d.gstNumber}</div>}
            </div>
          ) : (
            <div className="mt-1.5 text-sm text-muted-foreground">—</div>
          )}
        </div>

        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Order</div>
          <div className="mt-1.5 space-y-0.5 text-sm">
            <div>{invoice.orderKind === "VEHICLE" ? "Vehicle stock" : invoice.orderKind === "SPARE_PART" ? "Spare part" : "General"}</div>
            {invoice.expectedRestockDate && (
              <div className="text-xs text-muted-foreground">
                Expected {new Date(invoice.expectedRestockDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-border px-5 py-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Item</th>
              <th className="pb-2 font-medium">Qty</th>
              <th className="pb-2 text-right font-medium">Unit price</th>
              <th className="pb-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="py-2.5 pr-2">{invoice.item}</td>
              <td className="py-2.5 tabular-nums">
                {qty}
                {invoice.requestedQuantity != null && invoice.fulfilledQuantity != null && invoice.requestedQuantity !== invoice.fulfilledQuantity && (
                  <span className="ml-1 text-xs text-muted-foreground">/ {invoice.requestedQuantity}</span>
                )}
              </td>
              <td className="py-2.5 text-right tabular-nums">{priced ? inr(unitPrice) : "—"}</td>
              <td className="py-2.5 text-right tabular-nums">{priced ? inr(subtotal) : "—"}</td>
            </tr>
          </tbody>
        </table>

        {priced && (
          <div className="ml-auto mt-3 w-full max-w-[240px] space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{inr(subtotal)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>CGST (9%)</span><span className="tabular-nums">{inr(gst / 2)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>SGST (9%)</span><span className="tabular-nums">{inr(gst / 2)}</span></div>
            <div className="flex justify-between border-t border-border pt-1.5 text-base font-semibold" style={{ color: "var(--primary)" }}>
              <span>Total due</span><span className="tabular-nums">{inr(total)}</span>
            </div>
          </div>
        )}

        {invoice.message && (
          <div className="mt-4 rounded-[var(--radius)] bg-muted/40 p-3 text-sm leading-relaxed text-foreground/80">{invoice.message}</div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-3">
        <span className="text-[11px] text-muted-foreground">Issued by Order Management — Luxus Green Mobility.</span>
        <Button size="sm" onClick={() => downloadInvoicePdf(invoice)}>
          <Download className="h-3.5 w-3.5" /> Download PDF
        </Button>
      </div>
    </div>
  );
}
