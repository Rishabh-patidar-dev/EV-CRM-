"use client";

// ============================================================================
// Finance Management
// ============================================================================
// Route: /finance-management
// The manufacturer's own money view of the dealer network: what each dealer
// has been billed, what they've paid, what's still open against their credit
// limit, and how old that balance is.
//
// This is deliberately NOT a buyer-loan desk. Retail financing (a customer
// taking a loan to buy a scooter) is the dealer's own business with their own
// bank — it isn't something the OEM's ERP tracks. What an OEM's finance
// function actually owns is the receivable: goods went out, money needs to
// come back.
//
// Two rules, both enforced server-side in services/receivables.service.ts:
//   1. A dealer owes money when goods reach them — only DELIVERY and PARTIAL
//      invoices are billable. CONFIRMATION and DISPATCH are workflow
//      documents for the same order; counting them would bill it 3x.
//   2. Outstanding and aging are computed, never stored — payments are
//      allocated against invoices oldest-first, so the ledger can't drift.
// ============================================================================
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Landmark, Search, RefreshCw, Loader2, Plus, IndianRupee, Wallet,
  AlertTriangle, TrendingUp, ChevronLeft, X, Trash2,
} from "lucide-react";
import apiClient from "@/lib/api/client";
import Modal from "@/components/ui/Modal";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { useDeepLinkQuery } from "@/lib/useDeepLinkQuery";

type PaymentMode = "BANK_TRANSFER" | "CHEQUE" | "UPI" | "CASH" | "ADJUSTMENT";

const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "UPI", label: "UPI" },
  { value: "CASH", label: "Cash" },
  { value: "ADJUSTMENT", label: "Adjustment / credit note" },
];

interface Summary {
  totalBilled: number;
  totalCollected: number;
  outstanding: number;
  overdue: number;
  dealerCount: number;
  dealersWithBalance: number;
  aging: { current: number; d30: number; d60: number; d90plus: number };
}

interface DealerRow {
  id: number;
  dealerCode: string;
  legalName: string;
  tradeName: string | null;
  state: string;
  status: string;
  creditLimit: number | null;
  billed: number;
  collected: number;
  outstanding: number;
  utilisationPct: number | null;
  overLimit: boolean;
  openInvoiceCount: number;
  oldestUnpaidDays: number;
  overdue: number;
}

interface LedgerInvoice {
  id: number;
  invoiceNumber: string;
  item: string;
  type: string;
  issuedAt: string;
  amount: number;
  paid: number;
  balance: number;
  ageDays: number;
  settled: boolean;
}

interface LedgerPayment {
  id: number;
  amount: string | number;
  mode: PaymentMode;
  referenceNumber: string | null;
  paidAt: string;
  notes: string | null;
  invoice: { id: number; invoiceNumber: string } | null;
  recordedBy: { id: number; firstName: string | null; lastName: string | null } | null;
}

interface Ledger {
  dealer: {
    id: number; dealerCode: string; legalName: string; tradeName: string | null;
    email: string | null; phone: string | null; state: string;
    creditLimit: number | null; securityDeposit: number | null;
  };
  invoices: LedgerInvoice[];
  payments: LedgerPayment[];
  totals: { billed: number; collected: number; outstanding: number; overdue: number };
  aging: { current: number; d30: number; d60: number; d90plus: number };
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Red once a balance is genuinely late, amber as it approaches, else neutral. */
function ageTone(days: number): BadgeTone {
  if (days > 60) return "rejected";
  if (days > 30) return "pending";
  return "neutral";
}

export default function FinanceManagementPage() {
  const deepLinkQ = useDeepLinkQuery();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dealers, setDealers] = useState<DealerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState(deepLinkQ);
  const [onlyOutstanding, setOnlyOutstanding] = useState(false);
  const [openDealerId, setOpenDealerId] = useState<number | null>(null);
  const [payFor, setPayFor] = useState<DealerRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [s, d] = await Promise.all([
        apiClient.get("/api/v1/finance/summary"),
        apiClient.get("/api/v1/finance/dealers"),
      ]);
      setSummary(s.data);
      setDealers(d.data.dealers ?? []);
    } catch (error: any) {
      console.error("[FinanceManagementPage] failed to load receivables:", error);
      setSummary(null);
      setDealers([]);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load receivables. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = dealers;
    if (onlyOutstanding) rows = rows.filter((d) => d.outstanding > 0);
    if (q) rows = rows.filter((d) => d.legalName.toLowerCase().includes(q) || d.dealerCode.toLowerCase().includes(q) || (d.tradeName ?? "").toLowerCase().includes(q));
    // Biggest debtors first — that's the order a collections desk works in.
    return [...rows].sort((a, b) => b.outstanding - a.outstanding);
  }, [dealers, search, onlyOutstanding]);

  const aging = summary?.aging;
  const agingTotal = aging ? aging.current + aging.d30 + aging.d60 + aging.d90plus : 0;

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Landmark className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Finance Management</h1>
            <p className="mt-1 text-sm text-muted-foreground">Dealer receivables — what the network has been billed, what it has paid, and what is still open.</p>
          </div>
        </div>
        <Button onClick={() => setPayFor(dealers[0] ?? null)} disabled={dealers.length === 0}>
          <Plus className="h-4 w-4" /> Record payment
        </Button>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Billed to date" value={summary ? inr(summary.totalBilled) : "—"} tone="blue" />
        <StatCard icon={<Wallet className="h-4 w-4" />} label="Collected" value={summary ? inr(summary.totalCollected) : "—"} tone="green" />
        <StatCard icon={<IndianRupee className="h-4 w-4" />} label="Outstanding" value={summary ? inr(summary.outstanding) : "—"} tone="amber" />
        <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="Overdue (30+ days)" value={summary ? inr(summary.overdue) : "—"} tone="red" />
      </section>

      {/* Aging is the one view a finance desk actually works from — how old
          the open money is, not just how much of it there is. */}
      {aging && agingTotal > 0 && (
        <section className="mb-6 rounded-[var(--radius)] border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Receivables aging</h2>
            <span className="text-xs text-muted-foreground">{summary?.dealersWithBalance ?? 0} of {summary?.dealerCount ?? 0} dealers carrying a balance</span>
          </div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            {([
              ["current", aging.current, "var(--zira-approved)"],
              ["d30", aging.d30, "var(--zira-pending)"],
              ["d60", aging.d60, "var(--zira-info)"],
              ["d90plus", aging.d90plus, "var(--zira-rejected)"],
            ] as const).map(([key, value, color]) => (
              value > 0 ? <div key={key} style={{ width: `${(value / agingTotal) * 100}%`, background: color }} /> : null
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {([
              ["Current (≤30d)", aging.current, "var(--zira-approved)"],
              ["31–60 days", aging.d30, "var(--zira-pending)"],
              ["61–90 days", aging.d60, "var(--zira-info)"],
              ["90+ days", aging.d90plus, "var(--zira-rejected)"],
            ] as const).map(([label, value, color]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                <div className="min-w-0">
                  <div className="truncate text-xs text-muted-foreground">{label}</div>
                  <div className="tabular-nums">{inr(value)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
            placeholder="Search dealer name or code…"
            className="w-64 rounded-[var(--radius)] border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={onlyOutstanding} onChange={(e) => setOnlyOutstanding(e.target.checked)} className="h-4 w-4" />
          Only dealers with a balance
        </label>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">Billed</th>
              <th className="px-4 py-3 font-medium">Collected</th>
              <th className="px-4 py-3 font-medium">Outstanding</th>
              <th className="px-4 py-3 font-medium">Credit limit</th>
              <th className="px-4 py-3 font-medium">Oldest open</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{dealers.length === 0 ? "No dealers yet." : "No dealers match your search."}</td></tr>
            ) : (
              filtered.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => setOpenDealerId(d.id)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.tradeName || d.legalName}</div>
                    <div className="text-xs text-muted-foreground">{d.dealerCode} · {d.state}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{inr(d.billed)}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{inr(d.collected)}</td>
                  <td className="px-4 py-3 tabular-nums font-medium">
                    {inr(d.outstanding)}
                    {d.overdue > 0 && <div className="text-xs" style={{ color: "var(--zira-rejected)" }}>{inr(d.overdue)} overdue</div>}
                  </td>
                  <td className="px-4 py-3">
                    {d.creditLimit == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div>
                        <div className="tabular-nums text-muted-foreground">{inr(d.creditLimit)}</div>
                        {d.utilisationPct != null && (
                          <div className="mt-1 flex items-center gap-1.5">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full"
                                style={{
                                  width: `${Math.min(100, d.utilisationPct)}%`,
                                  background: d.overLimit ? "var(--zira-rejected)" : d.utilisationPct > 80 ? "var(--zira-pending)" : "var(--zira-approved)",
                                }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-muted-foreground">{d.utilisationPct}%</span>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {d.openInvoiceCount === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Badge label={`${d.oldestUnpaidDays}d · ${d.openInvoiceCount} open`} tone={ageTone(d.oldestUnpaidDays)} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setPayFor(d); }}>
                      Record payment
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <LedgerDrawer dealerId={openDealerId} onClose={() => setOpenDealerId(null)} onChanged={load} />
      <RecordPaymentModal dealer={payFor} dealers={dealers} onClose={() => setPayFor(null)} onSaved={load} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Per-dealer ledger — every billable invoice with how much of it is still
// open, plus the payment history that settled the rest.
// ----------------------------------------------------------------------------
function LedgerDrawer({ dealerId, onClose, onChanged }: { dealerId: number | null; onClose: () => void; onChanged: () => void }) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"invoices" | "payments">("invoices");
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!dealerId) return;
    setLoading(true);
    try {
      const { data } = await apiClient.get(`/api/v1/finance/dealers/${dealerId}/ledger`);
      setLedger(data);
    } catch (error) {
      console.error("[FinanceManagementPage] failed to load ledger:", error);
      setLedger(null);
    } finally {
      setLoading(false);
    }
  }, [dealerId]);

  useEffect(() => {
    setTab("invoices");
    load();
  }, [load]);

  async function deletePayment(id: number) {
    setDeleting(id);
    try {
      await apiClient.delete(`/api/v1/finance/payments/${id}`);
      await load();
      onChanged();
    } catch (error) {
      console.error("[FinanceManagementPage] failed to delete payment:", error);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Modal open={!!dealerId} onClose={onClose} title={ledger ? `${ledger.dealer.tradeName || ledger.dealer.legalName} — Ledger` : "Ledger"} width="max-w-3xl">
      {loading || !ledger ? (
        <div className="py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ["Billed", ledger.totals.billed],
              ["Collected", ledger.totals.collected],
              ["Outstanding", ledger.totals.outstanding],
              ["Overdue", ledger.totals.overdue],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius)] border border-border p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 tabular-nums font-medium">{inr(value)}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{ledger.dealer.dealerCode} · {ledger.dealer.state}</span>
            {ledger.dealer.creditLimit != null && <span>Credit limit {inr(ledger.dealer.creditLimit)}</span>}
            {ledger.dealer.securityDeposit != null && <span>Security deposit {inr(ledger.dealer.securityDeposit)}</span>}
            <Link href={`/dealer-management/${ledger.dealer.id}`} className="text-primary hover:underline">Open Dealer 360 →</Link>
          </div>

          <div className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-border bg-card p-1">
            {([["invoices", `Invoices (${ledger.invoices.length})`], ["payments", `Payments (${ledger.payments.length})`]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "invoices" ? (
            <div className="max-h-[45vh] overflow-y-auto rounded-[var(--radius)] border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Invoice</th>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Issued</th>
                    <th className="px-3 py-2 font-medium">Amount</th>
                    <th className="px-3 py-2 font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.invoices.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Nothing billed to this dealer yet.</td></tr>
                  ) : ledger.invoices.map((i) => (
                    <tr key={i.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{i.invoiceNumber}</td>
                      <td className="px-3 py-2">{i.item}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(i.issuedAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 tabular-nums">{inr(i.amount)}</td>
                      <td className="px-3 py-2">
                        {i.settled ? (
                          <Badge label="Settled" tone="approved" />
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="tabular-nums font-medium">{inr(i.balance)}</span>
                            <Badge label={`${i.ageDays}d`} tone={ageTone(i.ageDays)} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="max-h-[45vh] overflow-y-auto rounded-[var(--radius)] border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Amount</th>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 font-medium">Against</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {ledger.payments.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No payments recorded yet.</td></tr>
                  ) : ledger.payments.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">{new Date(p.paidAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 tabular-nums font-medium">{inr(Number(p.amount))}</td>
                      <td className="px-3 py-2">{PAYMENT_MODES.find((m) => m.value === p.mode)?.label ?? p.mode}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.referenceNumber || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.invoice ? p.invoice.invoiceNumber : "On account"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => deletePayment(p.id)}
                          disabled={deleting === p.id}
                          title="Remove this receipt"
                          className="text-muted-foreground hover:text-[color:var(--zira-rejected)]"
                        >
                          {deleting === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ----------------------------------------------------------------------------
// Record a receipt. Leaving the invoice unset is the normal case — an
// on-account payment settles the oldest open invoices first, same as a real
// ledger does.
// ----------------------------------------------------------------------------
function RecordPaymentModal({
  dealer,
  dealers,
  onClose,
  onSaved,
}: {
  dealer: DealerRow | null;
  dealers: DealerRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [dealerId, setDealerId] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("BANK_TRANSFER");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [openInvoices, setOpenInvoices] = useState<LedgerInvoice[]>([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dealer) return;
    setDealerId(String(dealer.id));
    setAmount("");
    setMode("BANK_TRANSFER");
    setReferenceNumber("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setNotes("");
    setInvoiceId("");
    setError(null);
  }, [dealer]);

  // The invoice picker only ever offers what's actually still open for the
  // chosen dealer, so a receipt can't be tagged to a settled document.
  useEffect(() => {
    if (!dealerId) return setOpenInvoices([]);
    let active = true;
    apiClient.get(`/api/v1/finance/dealers/${dealerId}/ledger`)
      .then(({ data }) => { if (active) setOpenInvoices((data.invoices ?? []).filter((i: LedgerInvoice) => !i.settled)); })
      .catch(() => { if (active) setOpenInvoices([]); });
    return () => { active = false; };
  }, [dealerId]);

  const selected = dealers.find((d) => String(d.id) === dealerId);

  async function handleSubmit() {
    setError(null);
    if (!dealerId) return setError("Choose a dealer");
    if (!(Number(amount) > 0)) return setError("Enter an amount greater than zero");

    setSubmitting(true);
    try {
      await apiClient.post("/api/v1/finance/payments", {
        dealerId,
        amount,
        mode,
        referenceNumber: referenceNumber.trim() || undefined,
        paidAt,
        invoiceId: invoiceId || undefined,
        notes: notes.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not record the payment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={!!dealer} onClose={onClose} title="Record payment">
      <div className="space-y-4">
        {error && (
          <div className="rounded-[var(--radius)] border px-3.5 py-2.5 text-sm" style={{ borderColor: "var(--destructive)", backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)", color: "var(--destructive)" }}>
            {error}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium">Dealer</label>
          <select value={dealerId} onChange={(e) => { setDealerId(e.target.value); setInvoiceId(""); }} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
            <option value="">Select a dealer…</option>
            {dealers.map((d) => (
              <option key={d.id} value={d.id}>{d.tradeName || d.legalName} — {inr(d.outstanding)} open</option>
            ))}
          </select>
          {selected && selected.outstanding > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {inr(selected.outstanding)} outstanding{selected.overdue > 0 ? `, ${inr(selected.overdue)} of it overdue` : ""}.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Amount, ₹</label>
            <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Received on</label>
            <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Reference no. (optional)</label>
            <input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="UTR / cheque no." className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Against invoice (optional)</label>
          <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
            <option value="">On account — settle oldest first</option>
            {openInvoices.map((i) => (
              <option key={i.id} value={i.id}>{i.invoiceNumber} — {inr(i.balance)} open ({i.ageDays}d)</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">Leave as &ldquo;on account&rdquo; unless the dealer paid one specific invoice.</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full">
          {submitting ? "Recording…" : "Record payment"}
        </Button>
      </div>
    </Modal>
  );
}
