"use client";

// ============================================================================
// Finance Management
// ============================================================================
// Route: /finance-management
// The buyer-finance pipeline every dealer feeds into: a walk-in buyer needs a
// loan, the dealer opens a case here, staff track it through the NBFC/bank
// process (docs → submitted → approved → disbursed) and can reject it at any
// point. Backed by the existing, previously-unused /api/v1/finance-cases API.
// ============================================================================
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Wallet,
  Plus,
  Search,
  RefreshCw,
  Loader2,
  Pencil,
  FileText,
  Clock,
  Send,
  CheckCircle2,
  Landmark,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import apiClient from "@/lib/api/client";
import Modal from "@/components/ui/Modal";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { useDeepLinkQuery } from "@/lib/useDeepLinkQuery";
import { FINANCE_LAST_SEEN_KEY } from "@/components/financeCasesSeen";

type FinanceCaseStatus = "NEW" | "DOCS_PENDING" | "SUBMITTED" | "APPROVED" | "DISBURSED" | "REJECTED";

interface FinanceDealer {
  id: number;
  dealerCode: string;
  legalName: string;
}

interface FinanceCaseRow {
  id: number;
  dealerId: number;
  leadId: number | null;
  buyerName: string;
  buyerPhone: string;
  vehicleModel: string | null;
  loanAmount: number | string | null;
  financierName: string | null;
  status: FinanceCaseStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  dealer: FinanceDealer | null;
}

interface DealerOption {
  id: number;
  legalName: string;
  tradeName: string | null;
}

type PipelineCounts = Partial<Record<FinanceCaseStatus, number>>;

const ALL_STATUSES: FinanceCaseStatus[] = ["NEW", "DOCS_PENDING", "SUBMITTED", "APPROVED", "DISBURSED", "REJECTED"];

const STATUS_META: Record<FinanceCaseStatus, { label: string; tone: BadgeTone; statTone: "blue" | "amber" | "purple" | "green" | "teal" | "red"; icon: typeof FileText }> = {
  NEW: { label: "New", tone: "pending", statTone: "blue", icon: FileText },
  DOCS_PENDING: { label: "Docs Pending", tone: "pending", statTone: "amber", icon: Clock },
  SUBMITTED: { label: "Submitted", tone: "pending", statTone: "purple", icon: Send },
  APPROVED: { label: "Approved", tone: "approved", statTone: "green", icon: CheckCircle2 },
  DISBURSED: { label: "Disbursed", tone: "approved", statTone: "teal", icon: Landmark },
  REJECTED: { label: "Rejected", tone: "rejected", statTone: "red", icon: XCircle },
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const LIMIT = 20;

export default function FinanceManagementPage() {
  const deepLinkQ = useDeepLinkQuery();
  const [cases, setCases] = useState<FinanceCaseRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineCounts>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [dealerFilter, setDealerFilter] = useState("");
  const [search, setSearch] = useState(deepLinkQ);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceCaseRow | null>(null);
  const [dealers, setDealers] = useState<DealerOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params: Record<string, string | number> = { page, limit: LIMIT };
      if (statusFilter) params.status = statusFilter;
      if (dealerFilter) params.dealerId = dealerFilter;
      const { data } = await apiClient.get("/api/v1/finance-cases", { params });
      setCases(data.financeCases ?? data.cases ?? []);
      setPipeline(data.pipeline ?? {});
      setTotal(data.pagination?.total ?? 0);
    } catch (error: any) {
      console.error("[FinanceManagementPage] failed to load finance cases:", error);
      setCases([]);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load finance cases. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, dealerFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiClient.get("/api/v1/dealers", { params: { limit: 200 } }).then((res) => {
      setDealers(res.data.dealers ?? res.data.data ?? []);
    }).catch(() => {});
  }, []);

  // Filter changes reset paging — a filtered result set has its own page 1.
  useEffect(() => { setPage(1); }, [statusFilter, dealerFilter]);

  // Clears the sidebar's new-case asterisk — Sidebar re-checks on every
  // route change, so every case sitting at NEW up to this moment no longer
  // counts as unseen the next time it does.
  useEffect(() => {
    try {
      localStorage.setItem(FINANCE_LAST_SEEN_KEY, new Date().toISOString());
    } catch {
      // localStorage unavailable (private mode etc.) — the indicator just
      // won't clear locally, not worth surfacing an error for.
    }
  }, []);

  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter((c) => c.buyerName.toLowerCase().includes(q) || c.buyerPhone.toLowerCase().includes(q));
  }, [cases, search]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="mx-auto max-w-[1300px] p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Wallet className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Finance Management</h1>
            <p className="mt-1 text-sm text-muted-foreground">The buyer-finance pipeline — track every case from a dealer through NBFC/bank approval and disbursal.</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New finance case
        </Button>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ALL_STATUSES.map((s) => {
          const meta = STATUS_META[s];
          const Icon = meta.icon;
          return (
            <StatCard
              key={s}
              icon={<Icon className="h-3.5 w-3.5" />}
              label={meta.label}
              value={pipeline[s] ?? 0}
              tone={meta.statTone}
            />
          );
        })}
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search buyer name or phone…"
            className="w-60 rounded-[var(--radius)] border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>
        <select value={dealerFilter} onChange={(e) => setDealerFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All dealers</option>
          {dealers.map((d) => (
            <option key={d.id} value={d.id}>{d.tradeName || d.legalName}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Buyer</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">Vehicle</th>
              <th className="px-4 py-3 font-medium">Loan amount</th>
              <th className="px-4 py-3 font-medium">Financier</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : loadError ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-[color:var(--zira-rejected)]">
                  {loadError}
                  <div className="mt-3">
                    <Button size="sm" variant="secondary" onClick={() => load()}>
                      <RefreshCw className="h-4 w-4" /> Retry
                    </Button>
                  </div>
                </td>
              </tr>
            ) : filteredCases.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">{cases.length === 0 ? "No finance cases yet." : "No cases match your search."}</td></tr>
            ) : (
              filteredCases.map((c) => {
                const meta = STATUS_META[c.status];
                const loan = c.loanAmount != null ? Number(c.loanAmount) : null;
                return (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{c.buyerName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.buyerPhone}</td>
                    <td className="px-4 py-3">
                      {c.dealer ? (
                        <Link href={`/dealer-management/${c.dealer.id}`} className="hover:underline">{c.dealer.legalName}</Link>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">{c.vehicleModel || "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{loan != null ? inr(loan) : "—"}</td>
                    <td className="px-4 py-3">{c.financierName || "—"}</td>
                    <td className="px-4 py-3"><Badge label={meta.label} tone={meta.tone} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && !loadError && total > LIMIT && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {totalPages} · {total} case{total === 1 ? "" : "s"}</span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Button>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <CreateCaseModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} dealers={dealers} />
      <EditCaseModal caseRow={editing} onClose={() => setEditing(null)} onSaved={load} />
    </div>
  );
}

function CreateCaseModal({
  open,
  onClose,
  onCreated,
  dealers,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  dealers: DealerOption[];
}) {
  const [dealerId, setDealerId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [financierName, setFinancierName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDealerId("");
    setBuyerName("");
    setBuyerPhone("");
    setVehicleModel("");
    setLoanAmount("");
    setFinancierName("");
    setNotes("");
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    if (!dealerId) return setError("Choose a dealer");
    if (!buyerName.trim()) return setError("Enter the buyer's name");
    if (!buyerPhone.trim()) return setError("Enter the buyer's phone number");

    setSubmitting(true);
    try {
      await apiClient.post("/api/v1/finance-cases", {
        dealerId,
        buyerName: buyerName.trim(),
        buyerPhone: buyerPhone.trim(),
        vehicleModel: vehicleModel.trim() || undefined,
        loanAmount: loanAmount || undefined,
        financierName: financierName.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onCreated();
      reset();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not create the finance case.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New finance case">
      <div className="space-y-4">
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Buyer name</label>
            <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Buyer phone</label>
            <input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Vehicle model (optional)</label>
          <input value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Loan amount, ₹ (optional)</label>
            <input type="number" min={0} value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Financier (optional)</label>
            <input value={financierName} onChange={(e) => setFinancierName(e.target.value)} placeholder="e.g. HDFC Bank" className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
        </div>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full">
          {submitting ? "Creating…" : "Create case"}
        </Button>
      </div>
    </Modal>
  );
}

interface FinanceAttachment {
  id: number;
  fileName: string;
  fileUrl: string;
  createdAt: string;
}

function resolveAttachmentUrl(fileUrl: string) {
  if (fileUrl.startsWith("http")) return fileUrl;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${base}${fileUrl}`;
}

function EditCaseModal({
  caseRow,
  onClose,
  onSaved,
}: {
  caseRow: FinanceCaseRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<FinanceCaseStatus>("NEW");
  const [financierName, setFinancierName] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<FinanceAttachment[]>([]);

  useEffect(() => {
    if (!caseRow) return;
    setStatus(caseRow.status);
    setFinancierName(caseRow.financierName ?? "");
    setLoanAmount(caseRow.loanAmount != null ? String(caseRow.loanAmount) : "");
    setNotes(caseRow.notes ?? "");
    setError(null);
    apiClient.get(`/api/v1/finance-cases/${caseRow.id}/attachments`)
      .then((r) => setAttachments(r.data.attachments ?? []))
      .catch(() => setAttachments([]));
  }, [caseRow]);

  async function handleSubmit() {
    if (!caseRow) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.patch(`/api/v1/finance-cases/${caseRow.id}`, {
        status,
        financierName: financierName.trim() || null,
        loanAmount: loanAmount ? loanAmount : null,
        notes: notes.trim() || null,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not update the finance case.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={!!caseRow} onClose={onClose} title={caseRow ? `${caseRow.buyerName} — Finance case` : "Finance case"}>
      {caseRow && (
        <div className="space-y-4">
          {error && (
            <div className="rounded-[var(--radius)] border px-3.5 py-2.5 text-sm" style={{ borderColor: "var(--destructive)", backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)", color: "var(--destructive)" }}>
              {error}
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            {caseRow.buyerPhone} · {caseRow.dealer?.legalName ?? "—"}{caseRow.vehicleModel ? ` · ${caseRow.vehicleModel}` : ""}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as FinanceCaseStatus)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Loan amount, ₹</label>
              <input type="number" min={0} value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Financier</label>
              <input value={financierName} onChange={(e) => setFinancierName(e.target.value)} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-[var(--radius)] border bg-transparent px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Documents from dealer</label>
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No documents uploaded yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <a href={resolveAttachmentUrl(a.fileUrl)} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                      {a.fileName}
                    </a>
                    <span className="ml-2 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button onClick={handleSubmit} disabled={submitting} className="w-full">
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
