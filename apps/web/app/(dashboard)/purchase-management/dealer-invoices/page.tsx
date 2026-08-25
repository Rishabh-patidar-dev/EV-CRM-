"use client";

// ============================================================================
// SUBMODULE — Dealer Purchase Invoices (read-only)
// ============================================================================
// Route: /purchase-management/dealer-invoices
// Dealers log these themselves through the DMS portal (OCR-assisted intake —
// see dealerPortal.controller.ts#createPurchaseInvoice). No approval/dispute
// workflow here, just visibility into what each dealer has logged — the
// full reconciliation workflow is a larger future module.
// ============================================================================
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Receipt, IndianRupee, Scan, FileText, Loader2, RefreshCw, Search } from "lucide-react";
import apiClient from "@/lib/api/client";
import { StatCard } from "@/components/ui/StatCard";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useDeepLinkQuery } from "@/lib/useDeepLinkQuery";

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

export default function DealerInvoicesPage() {
  const deepLinkQ = useDeepLinkQuery();
  const [invoices, setInvoices] = useState<DealerInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState(deepLinkQ);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await apiClient.get("/api/v1/purchase-management/dealer-invoices");
      setInvoices(data.invoices ?? []);
    } catch (error: any) {
      console.error("[DealerInvoicesPage] failed to load dealer invoices:", error);
      setInvoices([]);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load dealer invoices. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalAmount = invoices.reduce((sum, i) => sum + Number(i.amount), 0);
  const scannedCount = invoices.filter((i) => i.ocrStatus === "DONE").length;
  const dealerCount = new Set(invoices.map((i) => i.dealer.id)).size;

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((i) => i.invoiceNumber.toLowerCase().includes(q) || i.vendorName.toLowerCase().includes(q) || i.dealer.legalName.toLowerCase().includes(q));
  }, [invoices, search]);

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <Link href="/purchase-management" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Purchase Management
      </Link>

      <div className="mb-6 flex items-center gap-2">
        <Receipt className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">Dealer Purchase Invoices</h1>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">Read-only — every invoice a dealer has logged from the OEM or a spare-parts supplier, across the network.</p>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Receipt className="h-4 w-4" />} label="Invoices logged" value={invoices.length} tone="teal" />
        <StatCard icon={<IndianRupee className="h-4 w-4" />} label="Total value" value={`₹${totalAmount.toLocaleString("en-IN")}`} tone="green" />
        <StatCard icon={<Scan className="h-4 w-4" />} label="OCR-scanned" value={scannedCount} tone="blue" />
        <StatCard icon={<FileText className="h-4 w-4" />} label="Dealers" value={dealerCount} tone="purple" />
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice #, vendor, dealer…"
          className="w-full rounded-[var(--radius)] border border-border bg-card py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
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
            ) : filteredInvoices.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{invoices.length === 0 ? "No dealer has logged a purchase invoice yet." : "No invoices match your search."}</td></tr>
            ) : (
              filteredInvoices.map((inv) => (
                <React.Fragment key={inv.id}>
                  <tr onClick={() => setExpanded(expanded === inv.id ? null : inv.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50">
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
                  {expanded === inv.id && (
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
    </div>
  );
}
