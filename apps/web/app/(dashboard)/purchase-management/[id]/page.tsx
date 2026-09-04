"use client";

// ============================================================================
// Purchase order detail — the PO drill-down
// ============================================================================
// Route: /purchase-management/[id]
// The list page can only ever show a rolled-up "N received"; this is where the
// actual paper trail lives — every goods receipt note against this PO, its
// quality outcome, the vendor bill that was scanned at receipt, and the raw
// OCR text kept for audit. The PO's own actions (in transit / receive / pay /
// cancel) are repeated here so the page stands on its own.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Loader2, RefreshCw, Truck, IndianRupee, PackageCheck, FileText,
  ChevronDown, ChevronRight, Building2, Phone, Mail, MapPin, ShoppingCart, Ban,
} from "lucide-react";
import apiClient from "@/lib/api/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  PAYMENT_TONE, QUALITY_TONE, STATUS_TONE, ReceiveGoodsModal, RecordPaymentModal,
  Stars, fmtDate, fmtDateTime, resolveFileUrl,
  type GoodsReceipt, type PurchaseOrderDetail,
} from "../shared";

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const orderId = Number(params.id);

  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { data } = await apiClient.get(`/api/v1/purchase-management/orders/${orderId}`);
      setOrder(data);
    } catch (error: any) {
      console.error("[PurchaseOrderDetailPage] failed to load order:", error);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load this purchase order. Try refreshing.");
    }
  }, [orderId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const advance = async (status: string) => {
    setActionError(null);
    try {
      await apiClient.patch(`/api/v1/purchase-management/orders/${orderId}`, { status });
      await load();
    } catch (error: any) {
      console.error("[PurchaseOrderDetailPage] failed to update order:", error);
      setActionError(error?.response?.data?.message || error?.message || "Could not update this purchase order. Try again.");
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-[1600px] p-6">
        <div className="rounded-[var(--radius)] border border-dashed border-[color:var(--zira-rejected)]/40 p-10 text-center text-[color:var(--zira-rejected)]">
          {loadError}
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => load()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !order) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading purchase order…
      </div>
    );
  }

  const totalCost = order.totalCost ?? order.quantity * Number(order.unitCost);
  const amountPaid = Number(order.amountPaid);
  const amountOutstanding = order.amountOutstanding ?? Math.max(0, totalCost - amountPaid);
  const outstandingQty = order.quantityOutstanding ?? Math.max(0, order.quantity - order.quantityReceived);
  const receivable = order.status === "ORDERED" || order.status === "IN_TRANSIT" || order.status === "PARTIALLY_RECEIVED";

  return (
    <div className="mx-auto max-w-[1600px] p-6">
      <Link href="/purchase-management" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to purchase management
      </Link>

      {/* Header */}
      <Card className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ShoppingCart className="h-5 w-5 shrink-0 text-primary" />
            <h1 className="font-mono text-xl font-semibold tracking-tight">{order.poNumber}</h1>
            <Badge status={order.status} tone={STATUS_TONE[order.status] ?? "neutral"} />
            <Badge status={order.paymentStatus} tone={PAYMENT_TONE[order.paymentStatus] ?? "neutral"} />
          </div>
          <p className="mt-2 text-sm">
            {order.model} × {order.quantity} <span className="text-muted-foreground">({order.segment})</span> · ₹{Number(order.unitCost).toLocaleString("en-IN")} per unit
          </p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span>Ordered {fmtDate(order.orderedAt)}</span>
            <span>Expected {fmtDate(order.expectedAt)}</span>
            <span>Received {fmtDate(order.receivedAt)}</span>
          </div>
          {order.notes && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{order.notes}</p>}
        </div>

        <div className="flex flex-wrap justify-end gap-1.5">
          {order.status === "ORDERED" && (
            <Button size="sm" variant="secondary" onClick={() => advance("IN_TRANSIT")}>Mark in transit</Button>
          )}
          {receivable && (
            <Button size="sm" variant="secondary" onClick={() => setReceiving(true)}>
              <Truck className="h-3 w-3" /> Receive goods
            </Button>
          )}
          {order.paymentStatus !== "PAID" && order.status !== "CANCELLED" && (
            <Button size="sm" variant="secondary" onClick={() => setPaying(true)}>
              <IndianRupee className="h-3 w-3" /> Pay
            </Button>
          )}
          {(order.status === "ORDERED" || order.status === "IN_TRANSIT") && (
            <Button size="sm" variant="secondary" onClick={() => advance("CANCELLED")}>Cancel</Button>
          )}
        </div>
      </Card>

      {actionError && (
        <div className="mb-6 rounded-[var(--radius)] border border-dashed border-[color:var(--zira-rejected)]/40 p-3 text-center text-sm text-[color:var(--zira-rejected)]">
          {actionError}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Vendor card */}
        <Card>
          <div className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" /> Vendor
          </div>
          {order.vendor ? (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{order.vendor.name}</span>
                <Badge status={order.vendor.status} tone={order.vendor.status === "ACTIVE" ? "approved" : "rejected"} />
                {order.vendor.isMsme && <Badge label="MSME" tone="info" />}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Stars rating={order.vendor.qualityRating} /> quality rating
              </div>
              <div className="text-xs text-muted-foreground">{order.vendor.category.replace(/_/g, " ")}</div>
              <dl className="space-y-1.5 pt-1 text-xs">
                <Field label="GSTIN" value={order.vendor.gstNumber} mono />
                <Field label="PAN" value={order.vendor.panNumber} mono />
                <Field label="Contact" value={order.vendor.contactName} />
              </dl>
              <div className="space-y-1 pt-1 text-xs text-muted-foreground">
                {order.vendor.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {order.vendor.phone}</div>}
                {order.vendor.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {order.vendor.email}</div>}
                {order.vendor.address && <div className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {order.vendor.address}</div>}
              </div>
              {order.vendor.status === "BLACKLISTED" && order.vendor.blacklistReason && (
                <p className="flex items-start gap-1.5 pt-1 text-xs text-[color:var(--zira-rejected)]">
                  <Ban className="mt-0.5 h-3 w-3 shrink-0" /> {order.vendor.blacklistReason}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{order.supplierName} — no vendor record linked to this order.</p>
          )}
        </Card>

        {/* Delivery progress */}
        <Card>
          <div className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <PackageCheck className="h-3.5 w-3.5" /> Delivery
          </div>
          <Meter value={order.quantityReceived} total={order.quantity} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Figure label="Ordered" value={order.quantity} />
            <Figure label="Received" value={order.quantityReceived} />
            <Figure label="Outstanding" value={outstandingQty} />
          </div>
        </Card>

        {/* Money */}
        <Card>
          <div className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <IndianRupee className="h-3.5 w-3.5" /> Payment
          </div>
          <Meter value={amountPaid} total={totalCost} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Figure label="Total cost" value={`₹${totalCost.toLocaleString("en-IN")}`} />
            <Figure label="Paid" value={`₹${amountPaid.toLocaleString("en-IN")}`} />
            <Figure label="Outstanding" value={`₹${amountOutstanding.toLocaleString("en-IN")}`} />
          </div>
        </Card>
      </div>

      {/* Receipt history — the point of this page */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Goods receipt history <span className="font-normal text-muted-foreground">({order.goodsReceipts.length})</span>
        </h2>
        {order.goodsReceipts.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Nothing received against this purchase order yet.
            {receivable && (
              <div className="mt-3">
                <Button size="sm" variant="secondary" onClick={() => setReceiving(true)}>
                  <Truck className="h-3 w-3" /> Receive goods
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {order.goodsReceipts.map((grn) => (
              <GrnCard key={grn.id} grn={grn} />
            ))}
          </div>
        )}
      </section>

      {receiving && (
        <ReceiveGoodsModal
          order={order}
          onClose={() => setReceiving(false)}
          onDone={() => { setReceiving(false); load(); }}
        />
      )}
      {paying && (
        <RecordPaymentModal
          order={order}
          onClose={() => setPaying(false)}
          onDone={() => { setPaying(false); load(); }}
        />
      )}
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`truncate text-right ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-border px-2 py-2">
      <div className="truncate text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Meter({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-right text-xs text-muted-foreground">{pct}%</div>
    </div>
  );
}

// One goods receipt note — quantity + quality outcome, the vendor bill
// captured at receipt, and (collapsed) whatever the scanner actually read.
function GrnCard({ grn }: { grn: GoodsReceipt }) {
  const [showText, setShowText] = useState(false);
  const hasInvoice = grn.vendorInvoiceNumber || grn.vendorInvoiceDate || grn.vendorInvoiceAmount || grn.fileUrl;

  return (
    <Card padding="compact">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">{grn.grnNumber}</span>
            <Badge status={grn.qualityResult} tone={QUALITY_TONE[grn.qualityResult] ?? "neutral"} />
            <span className="text-xs text-muted-foreground">{fmtDateTime(grn.receivedAt)}</span>
          </div>
          {grn.rejectionReason && (
            <p className="mt-1.5 text-xs text-[color:var(--zira-rejected)]">Rejected — {grn.rejectionReason}</p>
          )}
          {grn.notes && <p className="mt-1.5 text-sm text-muted-foreground">{grn.notes}</p>}
        </div>
        <div className="shrink-0 rounded-[var(--radius)] border border-border px-3 py-1.5 text-center">
          <div className="text-lg font-semibold tabular-nums">{grn.quantityReceived}</div>
          <div className="text-xs text-muted-foreground">units received</div>
        </div>
      </div>

      {hasInvoice && (
        <div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">Vendor invoice</div>
            <div className="font-mono">{grn.vendorInvoiceNumber || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Invoice date</div>
            <div>{fmtDate(grn.vendorInvoiceDate)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Invoice amount</div>
            <div className="tabular-nums">{grn.vendorInvoiceAmount != null ? `₹${Number(grn.vendorInvoiceAmount).toLocaleString("en-IN")}` : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Scanned bill</div>
            {grn.fileUrl ? (
              <a href={resolveFileUrl(grn.fileUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{grn.fileName || "View bill"}</span>
              </a>
            ) : (
              <div>—</div>
            )}
          </div>
        </div>
      )}

      {grn.ocrExtractedText && (
        <div className="mt-3 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setShowText((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showText ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Scanned text{grn.ocrStatus ? ` (${grn.ocrStatus.toLowerCase()})` : ""}
          </button>
          {showText && (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius)] border border-border bg-background p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              {grn.ocrExtractedText}
            </pre>
          )}
        </div>
      )}
    </Card>
  );
}
