// ============================================================================
// Dealer receivables — the arithmetic behind Finance Management.
// ----------------------------------------------------------------------------
// Two rules define the whole module, and they're both deliberate:
//
//   1. A dealer owes money when goods actually reach them. Order Management
//      issues several documents per order (CONFIRMATION when stock is
//      reserved, DISPATCH when it leaves the warehouse, DELIVERY when it
//      lands), but only the last one represents a real liability — counting
//      all of them would bill the same order three times. PARTIAL counts too,
//      since a partial fulfillment is goods received.
//
//   2. Outstanding and aging are never stored, only computed. Payments are
//      allocated against invoices oldest-first (FIFO), which is what a real
//      ledger does for an unallocated "on account" receipt, so the numbers
//      can never drift away from the underlying invoices and payments.
// ============================================================================

/** Invoice types that actually create a payable for the dealer. */
export const BILLABLE_INVOICE_TYPES = ["DELIVERY", "PARTIAL"] as const;

export interface LedgerInvoice {
  id: number;
  invoiceNumber: string;
  item: string;
  issuedAt: Date;
  totalAmount: unknown;
}

export interface LedgerPayment {
  amount: unknown;
  invoiceId?: number | null;
}

export interface SettledInvoice {
  id: number;
  invoiceNumber: string;
  item: string;
  issuedAt: Date;
  amount: number;
  paid: number;
  balance: number;
  ageDays: number;
  settled: boolean;
}

export interface AgingBuckets {
  current: number; // not yet 30 days old
  d30: number; // 31–60 days
  d60: number; // 61–90 days
  d90plus: number; // over 90 days
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days between an invoice's issue date and now, floored at 0. */
export function ageInDays(issuedAt: Date, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(issuedAt).getTime()) / DAY_MS));
}

/**
 * Allocates payments against invoices oldest-first and returns each invoice
 * with how much of it is still open. Payments explicitly tagged to one
 * invoice settle that invoice first; whatever is left over (or was never
 * tagged) flows down the FIFO queue like any on-account receipt.
 */
export function settleInvoices(invoices: LedgerInvoice[], payments: LedgerPayment[], now = Date.now()): SettledInvoice[] {
  const ordered = [...invoices].sort((a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime());
  const paidByInvoice = new Map<number, number>();
  let onAccount = 0;

  for (const p of payments) {
    const amount = Number(p.amount ?? 0);
    if (amount <= 0) continue;
    if (p.invoiceId) paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) + amount);
    else onAccount += amount;
  }

  const settled: SettledInvoice[] = [];
  for (const inv of ordered) {
    const amount = Number(inv.totalAmount ?? 0);
    // A payment tagged to this invoice can overshoot it (rounding, a lump
    // settlement booked against one document) — the excess isn't lost, it
    // spills into the on-account pool for the next invoice in the queue.
    const tagged = paidByInvoice.get(inv.id) ?? 0;
    let paid = Math.min(amount, tagged);
    if (tagged > amount) onAccount += tagged - amount;

    if (paid < amount && onAccount > 0) {
      const take = Math.min(amount - paid, onAccount);
      paid += take;
      onAccount -= take;
    }

    const balance = Math.max(0, amount - paid);
    settled.push({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      item: inv.item,
      issuedAt: inv.issuedAt,
      amount,
      paid,
      balance,
      ageDays: ageInDays(inv.issuedAt, now),
      settled: balance <= 0.005,
    });
  }

  return settled;
}

/** Buckets the still-open balances by how long they've been outstanding. */
export function bucketAging(settled: SettledInvoice[]): AgingBuckets {
  const buckets: AgingBuckets = { current: 0, d30: 0, d60: 0, d90plus: 0 };
  for (const inv of settled) {
    if (inv.balance <= 0) continue;
    if (inv.ageDays <= 30) buckets.current += inv.balance;
    else if (inv.ageDays <= 60) buckets.d30 += inv.balance;
    else if (inv.ageDays <= 90) buckets.d60 += inv.balance;
    else buckets.d90plus += inv.balance;
  }
  return buckets;
}

/** Anything past 30 days is treated as overdue for the headline KPI. */
export function overdueAmount(settled: SettledInvoice[]): number {
  return settled.reduce((sum, inv) => (inv.balance > 0 && inv.ageDays > 30 ? sum + inv.balance : sum), 0);
}
