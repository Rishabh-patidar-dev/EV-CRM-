"use client";

// ============================================================================
// Close Orders
// ============================================================================
// Route: /order-management/Close
// Every order Check Inventory found short on manufacturer stock. The dealer
// sees nothing beyond "Close" here until staff manually send an
// out-of-stock notice (with an expected restock date, and optionally a
// partial-fulfillment offer) — that notice is what the SRS calls the "out of
// stock invoice." "Sort: best fit" ranks orders competing for the same item
// by how close they are to what's actually on hand, so staff can see which
// one to fulfil (in full or in part) first instead of guessing. "Recheck"
// re-runs the same comparison and clears the dispute to Approved once stock
// is back.
// ============================================================================
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle, Send, RefreshCcw, Mail, CheckCircle2, XCircle, Clock, Target, ArrowUpDown } from "lucide-react";
import apiClient from "@/lib/api/client";
import Modal from "@/components/ui/Modal";

interface Dispute {
  id: number;
  type: "VEHICLE" | "SPARE_PART";
  orderNumber: string;
  dealer: { id: number; dealerCode: string; legalName: string; tradeName: string | null; state: string } | null;
  item: string;
  quantity: number;
  status: string;
  groupKey: string;
  liveAvailableQuantity: number;
  shortfall: number;
  fulfillableNow: number;
  bestFitRank: number;
  recommended: boolean;
  updatedAt: string;
  notice: {
    id: number;
    status: "OPEN" | "SENT" | "RESOLVED";
    requestedQuantity: number;
    availableQuantity: number;
    expectedRestockDate: string | null;
    message: string | null;
    sentAt: string | null;
    offeredQuantity: number | null;
    dealerResponse: "PENDING" | "ACCEPTED" | "DECLINED";
  } | null;
}

type SortMode = "recent" | "bestFit";

export default function CloseOrdersPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [noticeTarget, setNoticeTarget] = useState<Dispute | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [recheckMsg, setRecheckMsg] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await apiClient.get("/api/v1/order-management/Close");
    setDisputes(data.disputes ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => {
    if (sortMode === "recent") return disputes;
    // Best fit: the order closest to fully using up what's on hand for its
    // item wins — smallest shortfall first, biggest order as the tiebreak
    // ("least difference, most profit"). Each item's own #1 pick floats up.
    return [...disputes].sort((a, b) => {
      if (a.groupKey !== b.groupKey) {
        // Keep items grouped together; order the groups by their best pick's shortfall.
        const aBest = disputes.filter((d) => d.groupKey === a.groupKey).reduce((m, d) => Math.min(m, d.shortfall), Infinity);
        const bBest = disputes.filter((d) => d.groupKey === b.groupKey).reduce((m, d) => Math.min(m, d.shortfall), Infinity);
        if (aBest !== bBest) return aBest - bBest;
        return a.groupKey.localeCompare(b.groupKey);
      }
      return a.bestFitRank - b.bestFitRank;
    });
  }, [disputes, sortMode]);

  const recheck = async (d: Dispute) => {
    setResolvingId(d.id);
    setRecheckMsg((m) => ({ ...m, [d.id]: "" }));
    try {
      const { data } = await apiClient.post(`/api/v1/order-management/Close/${d.type}/${d.id}/resolve`);
      if (data.sufficient) {
        setRecheckMsg((m) => ({ ...m, [d.id]: "Stock now sufficient — order approved." }));
        await load();
      } else {
        setRecheckMsg((m) => ({ ...m, [d.id]: `Still short — ${data.availableQuantity}/${data.requestedQuantity} available.` }));
        await load();
      }
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1300px] p-6">
      <Link href="/order-management" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Order Management
      </Link>

      <header className="mb-6 mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-6 w-6" style={{ color: "var(--zira-rejected)" }} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Close Orders</h1>
            <p className="mt-1 text-sm text-muted-foreground">Orders short on manufacturer stock — the dealer gets no confirmation until you send them a notice.</p>
          </div>
        </div>
        <button
          onClick={() => setSortMode((m) => (m === "bestFit" ? "recent" : "bestFit"))}
          className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius)] border px-3.5 py-2 text-sm font-medium transition-colors"
          style={
            sortMode === "bestFit"
              ? { background: "var(--primary)", borderColor: "var(--primary)", color: "var(--primary-foreground)" }
              : { borderColor: "var(--border)" }
          }
          title="Rank orders competing for the same stock by which one you can best fulfil right now"
        >
          {sortMode === "bestFit" ? <Target className="h-4 w-4" /> : <ArrowUpDown className="h-4 w-4" />}
          {sortMode === "bestFit" ? "Sorted: best fit" : "Sort: best fit"}
        </button>
      </header>

      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">Zone</th>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Requested vs. in stock</th>
              <th className="px-4 py-3 font-medium">Notice</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No Close orders — everything's in stock.</td></tr>
            ) : (
              sorted.map((d) => (
                <tr
                  key={`${d.type}-${d.id}`}
                  className="border-b border-border last:border-0 align-top"
                  style={sortMode === "bestFit" && d.recommended ? { backgroundColor: "color-mix(in srgb, #1f9d55 6%, transparent)" } : undefined}
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    {d.orderNumber}
                    {sortMode === "bestFit" && d.recommended && (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: "#1f9d55" }}>
                        <Target className="h-2.5 w-2.5" /> Best fit
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {d.dealer ? (
                      <Link href={`/dealer-management/${d.dealer.id}`} className="hover:underline">{d.dealer.tradeName || d.dealer.legalName}</Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{d.dealer?.state ?? "—"}</td>
                  <td className="px-4 py-3">{d.item} × {d.quantity}</td>
                  <td className="px-4 py-3">
                    <span className="badge-rejected rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
                      {d.liveAvailableQuantity} / {d.quantity} in stock
                    </span>
                    <div className="mt-1 text-[11px] text-muted-foreground">short by {d.shortfall}</div>
                  </td>
                  <td className="px-4 py-3">
                    {d.notice?.status === "SENT" ? (
                      <div className="space-y-1 text-xs">
                        <div className="flex items-center gap-1.5" style={{ color: "#1f9d55" }}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Sent{d.notice.expectedRestockDate ? ` · back ${new Date(d.notice.expectedRestockDate).toLocaleDateString()}` : ""}
                        </div>
                        {d.notice.offeredQuantity != null && (
                          <div className="text-muted-foreground">Offered {d.notice.offeredQuantity}/{d.notice.requestedQuantity} now</div>
                        )}
                        <DealerResponseBadge response={d.notice.dealerResponse} />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not sent yet</span>
                    )}
                    {recheckMsg[d.id] && <div className="mt-1 text-[11px] text-muted-foreground">{recheckMsg[d.id]}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-end gap-1.5">
                      <button
                        onClick={() => setNoticeTarget(d)}
                        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium hover:bg-accent"
                        style={{ borderColor: "var(--primary)", color: "var(--primary)" }}
                      >
                        <Send className="h-3 w-3" /> {d.notice?.status === "SENT" ? "Resend notice" : "Send notice"}
                      </button>
                      <button
                        onClick={() => recheck(d)}
                        disabled={resolvingId === d.id}
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-60"
                      >
                        <RefreshCcw className={`h-3 w-3 ${resolvingId === d.id ? "animate-spin" : ""}`} /> Recheck stock
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SendNoticeModal dispute={noticeTarget} onClose={() => setNoticeTarget(null)} onSent={load} />
    </div>
  );
}

function DealerResponseBadge({ response }: { response: "PENDING" | "ACCEPTED" | "DECLINED" }) {
  if (response === "ACCEPTED") return <div className="flex items-center gap-1 text-[#1f9d55]"><CheckCircle2 className="h-3 w-3" /> Dealer accepted</div>;
  if (response === "DECLINED") return <div className="flex items-center gap-1" style={{ color: "var(--zira-rejected)" }}><XCircle className="h-3 w-3" /> Dealer declined</div>;
  return <div className="flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3" /> Awaiting dealer</div>;
}

function SendNoticeModal({ dispute, onClose, onSent }: { dispute: Dispute | null; onClose: () => void; onSent: () => void }) {
  const [expectedRestockDate, setExpectedRestockDate] = useState("");
  const [message, setMessage] = useState("");
  const [offerPartial, setOfferPartial] = useState(false);
  const [offeredQuantity, setOfferedQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dispute) {
      setExpectedRestockDate(dispute.notice?.expectedRestockDate ? dispute.notice.expectedRestockDate.slice(0, 10) : "");
      const defaultOffer = Math.min(dispute.liveAvailableQuantity, dispute.quantity - 1);
      const hasOffer = dispute.notice?.offeredQuantity != null;
      setOfferPartial(hasOffer || defaultOffer > 0);
      setOfferedQuantity(String(dispute.notice?.offeredQuantity ?? Math.max(defaultOffer, 0)));
      setMessage(
        dispute.notice?.message ??
          `We're currently short on ${dispute.item} for order ${dispute.orderNumber}. We'll fulfil the remaining quantity once new stock arrives.`
      );
      setError(null);
    }
  }, [dispute]);

  if (!dispute) return null;

  const offerNum = parseInt(offeredQuantity) || 0;
  const offerValid = !offerPartial || (offerNum > 0 && offerNum < dispute.quantity);

  const submit = async () => {
    if (!offerValid) { setError(`Offer must be between 1 and ${dispute.quantity - 1}`); return; }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/api/v1/order-management/Close/${dispute.type}/${dispute.id}/notice`, {
        expectedRestockDate: expectedRestockDate || undefined,
        message: message || undefined,
        offeredQuantity: offerPartial ? offerNum : undefined,
      });
      onSent();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not send the notice.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={!!dispute} onClose={onClose} title={`Send out-of-stock notice — ${dispute.orderNumber}`}>
      <div className="space-y-4">
        <div className="rounded-[var(--radius)] border border-border bg-accent/40 p-3 text-xs text-muted-foreground">
          <Mail className="mb-1 h-3.5 w-3.5" /> This is the only confirmation the dealer will see for this order until stock is available — it replaces the order-confirmation invoice.
        </div>

        {error && (
          <div className="rounded-[var(--radius)] border px-3.5 py-2.5 text-sm" style={{ borderColor: "var(--destructive)", color: "var(--destructive)" }}>{error}</div>
        )}

        <div className="rounded-[var(--radius)] border border-border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={offerPartial} onChange={(e) => setOfferPartial(e.target.checked)} disabled={dispute.liveAvailableQuantity <= 0} />
            Offer partial fulfillment now
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            {dispute.liveAvailableQuantity} in stock for {dispute.quantity} requested — offer some now, dealer confirms from DMS, and the remainder becomes a fresh backorder.
          </p>
          {offerPartial && (
            <div className="mt-2">
              <input
                type="number"
                min={1}
                max={dispute.quantity - 1}
                value={offeredQuantity}
                onChange={(e) => setOfferedQuantity(e.target.value)}
                className="w-32 rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
              <span className="ml-2 text-xs text-muted-foreground">of {dispute.quantity} requested</span>
              {!offerValid && <p className="mt-1 text-xs" style={{ color: "var(--destructive)" }}>Must be between 1 and {dispute.quantity - 1}.</p>}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Expected date for order renewal</label>
          <input
            type="date"
            value={expectedRestockDate}
            onChange={(e) => setExpectedRestockDate(e.target.value)}
            className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Message to dealer</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          />
        </div>

        <button
          onClick={submit}
          disabled={submitting || !offerValid}
          className="w-full rounded-[var(--radius)] bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Sending…" : "Send notice"}
        </button>
      </div>
    </Modal>
  );
}
