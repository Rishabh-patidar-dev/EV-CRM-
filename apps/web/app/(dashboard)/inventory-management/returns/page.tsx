"use client";

// ============================================================================
// Spare Part Returns
// ============================================================================
// Route: /inventory-management/returns
// The closed loop for "this part failed quality": a dealer flags a
// defective quantity from their own stock in DMS (dealerPortal.controller.ts
// #createSparePartReturn, no stock movement yet). Staff review it here —
// approve/reject, then resolve (replaced sends a fresh unit and draws down
// OEM stock, credited is a financial settlement only) — which is the actual
// physical/financial event, logged to Inventory Logs like every other
// inventory movement. Backed by /api/v1/spare-part-returns
// (SparePartReturnController, dealerAfterSales.controller.ts).
// ============================================================================
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Undo2, Search, RefreshCw, Loader2, Eye, Clock, CheckCircle2, XCircle, PackageCheck,
} from "lucide-react";
import apiClient from "@/lib/api/client";
import Modal from "@/components/ui/Modal";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { useDeepLinkQuery } from "@/lib/useDeepLinkQuery";
import { RETURNS_LAST_SEEN_KEY } from "@/components/sparePartReturnsSeen";

type ReturnStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "RESOLVED";
type ReturnResolution = "REPLACED" | "CREDITED";

interface ReturnDealer {
  id: number;
  dealerCode: string;
  legalName: string;
}

interface ReturnRow {
  id: number;
  dealerId: number;
  partName: string;
  partCode: string | null;
  quantity: number;
  reason: string;
  status: ReturnStatus;
  resolution: ReturnResolution | null;
  staffNotes: string | null;
  createdAt: string;
  dealer: ReturnDealer | null;
}

interface ReturnAttachment {
  id: number;
  fileName: string;
  fileUrl: string;
  createdAt: string;
}

type PipelineCounts = Partial<Record<ReturnStatus, number>>;

const ALL_STATUSES: ReturnStatus[] = ["REQUESTED", "APPROVED", "REJECTED", "RESOLVED"];

const STATUS_META: Record<ReturnStatus, { label: string; tone: BadgeTone; statTone: "blue" | "amber" | "green" | "red" | "teal"; icon: typeof Clock }> = {
  REQUESTED: { label: "Requested", tone: "pending", statTone: "amber", icon: Clock },
  APPROVED: { label: "Approved", tone: "approved", statTone: "blue", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", tone: "rejected", statTone: "red", icon: XCircle },
  RESOLVED: { label: "Resolved", tone: "approved", statTone: "green", icon: PackageCheck },
};

function resolveAttachmentUrl(fileUrl: string) {
  if (fileUrl.startsWith("http")) return fileUrl;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${base}${fileUrl}`;
}

export default function SparePartReturnsPage() {
  const deepLinkQ = useDeepLinkQuery();
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineCounts>({});
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState(deepLinkQ);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<ReturnRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const { data } = await apiClient.get("/api/v1/spare-part-returns", { params });
      setReturns(data.returns ?? []);
      setPipeline(data.pipeline ?? {});
    } catch (error: any) {
      console.error("[SparePartReturnsPage] failed to load returns:", error);
      setReturns([]);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load spare part returns. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  // Clears the sidebar's asterisk — Sidebar re-checks on every route
  // change, so every request sitting at REQUESTED up to this moment no
  // longer counts as unseen the next time it does.
  useEffect(() => {
    try {
      localStorage.setItem(RETURNS_LAST_SEEN_KEY, new Date().toISOString());
    } catch {
      // localStorage unavailable (private mode etc.) — the indicator just
      // won't clear locally, not worth surfacing an error for.
    }
  }, []);

  const filteredReturns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return returns;
    return returns.filter((r) => r.partName.toLowerCase().includes(q) || (r.dealer?.legalName ?? "").toLowerCase().includes(q));
  }, [returns, search]);

  return (
    <div className="mx-auto max-w-[1300px] p-6">
      <header className="mb-6 flex items-center gap-2.5">
        <Undo2 className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Spare Part Returns</h1>
          <p className="mt-1 text-sm text-muted-foreground">Quality-return requests dealers have flagged from their own stock — review, decide, and resolve.</p>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ALL_STATUSES.map((s) => {
          const meta = STATUS_META[s];
          const Icon = meta.icon;
          return (
            <StatCard key={s} icon={<Icon className="h-3.5 w-3.5" />} label={meta.label} value={pipeline[s] ?? 0} tone={meta.statTone} />
          );
        })}
      </section>

      {loadError && (
        <div className="mb-4 rounded-[var(--radius)] border px-4 py-3 text-sm" style={{ borderColor: "var(--zira-rejected)", color: "var(--zira-rejected)" }}>
          {loadError}
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => load()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search part or dealer…"
            className="w-60 rounded-[var(--radius)] border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">Part</th>
              <th className="px-4 py-3 font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Requested</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : filteredReturns.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{returns.length === 0 ? "No quality-return requests yet." : "No requests match your search."}</td></tr>
            ) : (
              filteredReturns.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      {r.dealer ? <Link href={`/dealer-management/${r.dealer.id}`} className="hover:underline">{r.dealer.legalName}</Link> : "—"}
                    </td>
                    <td className="px-4 py-3">{r.partName}</td>
                    <td className="px-4 py-3 tabular-nums">{r.quantity}</td>
                    <td className="px-4 py-3 max-w-[240px] truncate" title={r.reason}>{r.reason}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge label={meta.label} tone={meta.tone} />
                        {r.resolution && <span className="text-[10px] font-medium uppercase text-muted-foreground">{r.resolution}</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setReviewing(r)}>
                        <Eye className="h-3 w-3" /> Review
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ReviewModal returnRow={reviewing} onClose={() => setReviewing(null)} onSaved={load} />
    </div>
  );
}

function ReviewModal({ returnRow, onClose, onSaved }: { returnRow: ReturnRow | null; onClose: () => void; onSaved: () => void }) {
  const [resolution, setResolution] = useState<ReturnResolution>("REPLACED");
  const [staffNotes, setStaffNotes] = useState("");
  const [submitting, setSubmitting] = useState<ReturnStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ReturnAttachment[]>([]);

  useEffect(() => {
    if (!returnRow) return;
    setResolution("REPLACED");
    setStaffNotes(returnRow.staffNotes ?? "");
    setError(null);
    apiClient.get(`/api/v1/spare-part-returns/${returnRow.id}/attachments`)
      .then((r) => setAttachments(r.data.attachments ?? []))
      .catch(() => setAttachments([]));
  }, [returnRow]);

  async function advance(status: ReturnStatus) {
    if (!returnRow) return;
    setError(null);
    setSubmitting(status);
    try {
      await apiClient.post(`/api/v1/spare-part-returns/${returnRow.id}/status`, {
        status,
        resolution: status === "RESOLVED" ? resolution : undefined,
        staffNotes: staffNotes.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not update the return.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Modal open={!!returnRow} onClose={onClose} title={returnRow ? `${returnRow.partName} — Quality return` : "Quality return"}>
      {returnRow && (
        <div className="space-y-4">
          {error && (
            <div className="rounded-[var(--radius)] border px-3.5 py-2.5 text-sm" style={{ borderColor: "var(--destructive)", backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)", color: "var(--destructive)" }}>
              {error}
            </div>
          )}

          <div className="text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Dealer</span><span>{returnRow.dealer?.legalName ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Quantity</span><span>{returnRow.quantity}</span></div>
            <div className="mt-2">
              <span className="text-muted-foreground">Reason</span>
              <p className="mt-1 rounded-[var(--radius)] border border-border bg-muted/30 p-2.5">{returnRow.reason}</p>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Photos / evidence from dealer</label>
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No files uploaded yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <a href={resolveAttachmentUrl(a.fileUrl)} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">{a.fileName}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Staff notes</label>
            <textarea
              value={staffNotes}
              onChange={(e) => setStaffNotes(e.target.value)}
              rows={3}
              readOnly={returnRow.status === "REJECTED" || returnRow.status === "RESOLVED"}
              className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm disabled:opacity-60"
              style={{ borderColor: "var(--border)" }}
            />
          </div>

          {returnRow.status === "REQUESTED" && (
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => advance("APPROVED")} disabled={!!submitting}>
                {submitting === "APPROVED" ? "Approving…" : "Approve"}
              </Button>
              <Button className="flex-1" variant="secondary" onClick={() => advance("REJECTED")} disabled={!!submitting}>
                {submitting === "REJECTED" ? "Rejecting…" : "Reject"}
              </Button>
            </div>
          )}

          {returnRow.status === "APPROVED" && (
            <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
              <label className="block text-sm font-medium">Resolve as</label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5"><input type="radio" checked={resolution === "REPLACED"} onChange={() => setResolution("REPLACED")} /> Replaced</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={resolution === "CREDITED"} onChange={() => setResolution("CREDITED")} /> Credited</label>
              </div>
              <p className="text-xs text-muted-foreground">
                {resolution === "REPLACED"
                  ? "The bad quantity leaves the dealer's stock and a fresh unit is credited back — manufacturer stock is drawn down for it."
                  : "The bad quantity leaves the dealer's stock, settled as a credit — no replacement unit sent."}
              </p>
              <Button className="w-full" onClick={() => advance("RESOLVED")} disabled={!!submitting}>
                {submitting === "RESOLVED" ? "Resolving…" : "Resolve return"}
              </Button>
            </div>
          )}

          {(returnRow.status === "REJECTED" || returnRow.status === "RESOLVED") && (
            <p className="text-xs text-muted-foreground">This return is closed.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
