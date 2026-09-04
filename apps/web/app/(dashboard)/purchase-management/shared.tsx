"use client";

// ============================================================================
// Purchase & Vendor Management — shared pieces
// ----------------------------------------------------------------------------
// The list page (/purchase-management) and the PO drill-down
// (/purchase-management/[id]) both raise the same goods-receipt and payment
// modals against the same purchase order, so those two live here rather than
// being duplicated in each page file. Everything else stays file-local to the
// page that uses it, matching how the rest of this app is written.
// ============================================================================
import React, { useRef, useState } from "react";
import { Loader2, Star, ScanLine, Keyboard, AlertTriangle, RotateCcw, FileText } from "lucide-react";
import apiClient from "@/lib/api/client";
import Modal from "@/components/ui/Modal";
import { type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export const SEGMENTS = ["L5", "L3", "CUSTOMISED"];
export const CATEGORIES = ["BATTERY_PACK", "BMS", "MOTOR", "CONTROLLER", "CHASSIS", "BODY", "ELECTRICAL", "TYRES", "MISC"];
export const PO_STATUSES = ["ORDERED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"];

export const STATUS_TONE: Record<string, BadgeTone> = {
  ORDERED: "pending",
  IN_TRANSIT: "pending",
  PARTIALLY_RECEIVED: "pending",
  RECEIVED: "approved",
  CANCELLED: "rejected",
};

export const PAYMENT_TONE: Record<string, BadgeTone> = {
  UNPAID: "rejected",
  PARTIAL: "pending",
  PAID: "approved",
};

export const QUALITY_TONE: Record<string, BadgeTone> = {
  PASS: "approved",
  PARTIAL_ACCEPT: "pending",
  REJECT: "rejected",
};

export interface Vendor {
  id: number;
  name: string;
  category: string;
  gstNumber?: string | null;
  panNumber?: string | null;
  isMsme?: boolean;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  qualityRating: number;
  status: "ACTIVE" | "BLACKLISTED";
  blacklistReason: string | null;
  _count?: { purchaseOrders: number };
}

export interface GoodsReceipt {
  id: number;
  grnNumber: string;
  quantityReceived: number;
  qualityResult: string;
  rejectionReason: string | null;
  notes: string | null;
  receivedAt: string;
  vendorInvoiceNumber: string | null;
  vendorInvoiceDate: string | null;
  vendorInvoiceAmount: string | null;
  fileUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  ocrExtractedText: string | null;
  ocrStatus: string | null;
}

export interface PurchaseOrder {
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
  notes?: string | null;
}

// GET /orders/:id — the same order plus the full vendor record, every GRN,
// and the quantity/money roll-ups the server computes.
export interface PurchaseOrderDetail extends PurchaseOrder {
  vendor: Vendor | null;
  goodsReceipts: GoodsReceipt[];
  quantityOutstanding: number;
  totalCost: number;
  amountOutstanding: number;
  notes: string | null;
}

interface OcrPreview {
  fileUrl: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  ocrExtractedText: string | null;
  ocrStatus: "DONE" | "FAILED" | "SKIPPED";
  suggested: { vendorName?: string; vendorGstin?: string; invoiceNumber?: string; invoiceDate?: string; amount?: string };
  items: { partName: string; quantity: number; unitPrice: string }[];
  suggestedQuantity: number | null;
}

// Uploaded files come back as an API-relative path — same resolution the
// shared AttachmentUpload does.
export function resolveFileUrl(fileUrl: string) {
  if (fileUrl.startsWith("http")) return fileUrl;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${base}${fileUrl}`;
}

export function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${rating}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={`h-3 w-3 ${i < rating ? "fill-current text-[color:var(--zira-pending)]" : "text-muted-foreground/30"}`} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Receive goods — scan the vendor's bill, then confirm the receipt
// ---------------------------------------------------------------------------
// Two steps on purpose: the storekeeper either scans the paper challan (OCR
// pre-fills the quantity and the invoice header) or skips straight to typing
// it. Nothing the scan suggests is ever submitted unreviewed — a wrong
// quantity here creates real VehicleUnit stock rows.
export function ReceiveGoodsModal({
  order,
  onClose,
  onDone,
}: {
  order: Pick<PurchaseOrder, "id" | "poNumber" | "model" | "quantity" | "quantityReceived">;
  onClose: () => void;
  onDone: () => void;
}) {
  const remaining = Math.max(0, order.quantity - order.quantityReceived);

  const [step, setStep] = useState<"choose" | "form">("choose");
  const [scan, setScan] = useState<OcrPreview | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [quantityReceived, setQuantityReceived] = useState(String(remaining || 1));
  const [qualityResult, setQualityResult] = useState("PASS");
  const [rejectionReason, setRejectionReason] = useState("");
  const [notes, setNotes] = useState("");
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState("");
  const [vendorInvoiceDate, setVendorInvoiceDate] = useState("");
  const [vendorInvoiceAmount, setVendorInvoiceAmount] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isImageScan = !!scan && (scan.mimeType?.startsWith("image/") ?? false);

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    setScanning(true);
    setScanError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await apiClient.post<OcrPreview>("/api/v1/purchase-management/grn/ocr-preview", body, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setScan(data);

      let applied = false;
      if (data.suggestedQuantity != null && data.suggestedQuantity > 0) {
        setQuantityReceived(String(data.suggestedQuantity));
        applied = true;
      }
      if (data.suggested?.invoiceNumber) { setVendorInvoiceNumber(data.suggested.invoiceNumber); applied = true; }
      if (data.suggested?.invoiceDate) { setVendorInvoiceDate(data.suggested.invoiceDate); applied = true; }
      if (data.suggested?.amount) { setVendorInvoiceAmount(data.suggested.amount); applied = true; }
      setPrefilled(applied);
      setStep("form");
    } catch (e: any) {
      setScanError(e?.response?.data?.message ?? "Could not read that file. Try another scan, or enter the receipt manually.");
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const startOver = () => {
    setScan(null);
    setPrefilled(false);
    setScanError(null);
    setError(null);
    setQuantityReceived(String(remaining || 1));
    setVendorInvoiceNumber("");
    setVendorInvoiceDate("");
    setVendorInvoiceAmount("");
    setStep("choose");
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post(`/api/v1/purchase-management/orders/${order.id}/receive`, {
        quantityReceived: Number(quantityReceived),
        qualityResult,
        rejectionReason: qualityResult === "REJECT" ? rejectionReason : undefined,
        notes: notes || undefined,
        vendorInvoiceNumber: vendorInvoiceNumber || undefined,
        vendorInvoiceDate: vendorInvoiceDate || undefined,
        vendorInvoiceAmount: vendorInvoiceAmount || undefined,
        // The scanned bill itself travels with the GRN so the receipt keeps
        // its paper trail permanently.
        fileUrl: scan?.fileUrl,
        storagePath: scan?.storagePath,
        fileName: scan?.fileName,
        mimeType: scan?.mimeType,
        ocrExtractedText: scan?.ocrExtractedText ?? undefined,
        ocrStatus: scan?.ocrStatus,
      });
      onDone();
    } catch (e: any) {
      // Includes the server's over-receipt guard ("Only N of M still to
      // receive on this order") — shown as-is rather than swallowed.
      setError(e?.response?.data?.message ?? "Could not record receipt");
    } finally {
      setSaving(false);
    }
  };

  const qty = Number(quantityReceived);
  const invalidQty = !Number.isFinite(qty) || qty < 1;

  return (
    <Modal open onClose={onClose} title={`Receive goods — ${order.poNumber}`} width={step === "form" && scan ? "max-w-4xl" : "max-w-lg"}>
      <p className="mb-4 text-xs text-muted-foreground">
        {order.model} · {remaining} of {order.quantity} still outstanding
      </p>

      {step === "choose" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Scan the vendor's bill or delivery challan to pre-fill this receipt, or enter it by hand.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius)] border border-dashed border-border p-6 text-center hover:border-primary hover:text-primary ${scanning ? "pointer-events-none opacity-60" : ""}`}
            >
              {scanning ? <Loader2 className="h-6 w-6 animate-spin" /> : <ScanLine className="h-6 w-6" />}
              <span className="text-sm font-medium">{scanning ? "Reading the bill…" : "Scan vendor bill"}</span>
              <span className="text-xs text-muted-foreground">JPG or PNG reads best · PDFs attach without OCR</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                disabled={scanning}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </label>
            <button
              type="button"
              disabled={scanning}
              onClick={() => setStep("form")}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius)] border border-dashed border-border p-6 text-center hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-60"
            >
              <Keyboard className="h-6 w-6" />
              <span className="text-sm font-medium">Enter manually</span>
              <span className="text-xs text-muted-foreground">No bill to hand — type the receipt</span>
            </button>
          </div>
          {scanError && <p className="text-xs text-[color:var(--zira-rejected)]">{scanError}</p>}
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          {prefilled && (
            <div className="mb-4 flex items-start gap-2 rounded-[var(--radius)] border border-[color:var(--zira-pending)]/40 bg-[color:var(--zira-pending)]/10 p-3 text-xs text-[color:var(--zira-pending)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                These fields were pre-filled from the scan — check every one against the paper before saving. Accepted units become
                real stock.
              </span>
            </div>
          )}
          {scan && scan.ocrStatus !== "DONE" && (
            <div className="mb-4 rounded-[var(--radius)] border border-border bg-background p-3 text-xs text-muted-foreground">
              {scan.ocrStatus === "SKIPPED"
                ? "The bill was attached, but PDFs can't be read automatically — enter the details by hand."
                : "The scan couldn't be read — the bill is still attached, enter the details by hand."}
            </div>
          )}

          <div className={scan ? "grid gap-5 lg:grid-cols-2" : ""}>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Quantity received</label>
                <input
                  type="number"
                  min={1}
                  max={remaining}
                  value={quantityReceived}
                  onChange={(e) => setQuantityReceived(e.target.value)}
                  className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">{remaining} still to receive on this order.</p>
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

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Vendor invoice / challan no.</label>
                  <input value={vendorInvoiceNumber} onChange={(e) => setVendorInvoiceNumber(e.target.value)} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" placeholder="e.g. INV-2291" />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Invoice date</label>
                  <input type="date" value={vendorInvoiceDate} onChange={(e) => setVendorInvoiceDate(e.target.value)} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Amount (₹)</label>
                  <input type="number" min={0} value={vendorInvoiceAmount} onChange={(e) => setVendorInvoiceAmount(e.target.value)} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" placeholder="Anything worth recording about this delivery" />
              </div>
            </div>

            {scan && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" /> Scanned bill
                  </span>
                  <Button size="sm" variant="ghost" onClick={startOver}>
                    <RotateCcw className="h-3 w-3" /> Start over
                  </Button>
                </div>
                <a href={resolveFileUrl(scan.fileUrl)} target="_blank" rel="noreferrer" className="block truncate text-xs text-primary hover:underline">
                  {scan.fileName}
                </a>
                {isImageScan ? (
                  <a href={resolveFileUrl(scan.fileUrl)} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={resolveFileUrl(scan.fileUrl)} alt={scan.fileName} className="max-h-56 w-full rounded-[var(--radius)] border border-border object-contain" />
                  </a>
                ) : (
                  <div className="rounded-[var(--radius)] border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                    No image preview for this file type.
                  </div>
                )}
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Extracted text</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius)] border border-border bg-background p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                    {scan.ocrExtractedText?.trim() || "Nothing could be read from this file."}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {error && <p className="mt-3 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
          <div className="mt-4 flex justify-between gap-2">
            {!scan ? (
              <Button size="sm" variant="ghost" onClick={startOver}>
                <ScanLine className="h-3 w-3" /> Scan a bill instead
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
              <Button size="sm" disabled={saving || invalidQty || (qualityResult === "REJECT" && !rejectionReason)} onClick={submit}>
                {saving ? "Recording…" : "Record GRN"}
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

export function RecordPaymentModal({
  order,
  onClose,
  onDone,
}: {
  order: Pick<PurchaseOrder, "id" | "poNumber" | "quantity" | "unitCost" | "amountPaid">;
  onClose: () => void;
  onDone: () => void;
}) {
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
