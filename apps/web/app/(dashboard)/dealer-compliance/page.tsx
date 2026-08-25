"use client";

// ============================================================================
// NEW SUBMODULE — Compliance & Document Renewals
// ============================================================================
// Route: /dealer-compliance[?dealerId=]
// Ongoing post-go-live compliance: dealer agreement, trade license,
// insurance, statutory NOCs — each with an expiry date. Status
// (VALID / EXPIRING_SOON / EXPIRED / MISSING) is computed server-side from
// expiresAt on every load.
// ============================================================================
import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck, BellRing, Plus, Loader2 } from "lucide-react";
import apiClient from "@/lib/api/client";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const DOC_TYPES = [
  "DEALER_AGREEMENT", "TRADE_LICENSE", "GST_CERTIFICATE", "INSURANCE_POLICY",
  "FIRE_NOC", "POLLUTION_NOC", "SHOWROOM_LEASE", "DISCOM_SANCTION", "OTHER",
];
const STATUSES = ["EXPIRED", "EXPIRING_SOON", "VALID", "MISSING"];

const STATUS_TONE: Record<string, BadgeTone> = {
  VALID: "approved",
  EXPIRING_SOON: "pending",
  EXPIRED: "rejected",
  MISSING: "rejected",
};

interface Dealer {
  id: number;
  dealerCode: string;
  legalName: string;
  tradeName?: string | null;
}

export default function DealerCompliancePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <DealerComplianceInner />
    </Suspense>
  );
}

function DealerComplianceInner() {
  const searchParams = useSearchParams();
  const dealerIdParam = searchParams.get("dealerId") ?? "";

  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [dealerFilter, setDealerFilter] = useState(dealerIdParam);
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDealers = useCallback(async () => {
    const { data } = await apiClient.get("/api/v1/dealers", { params: { limit: 100 } });
    setDealers(data.dealers ?? []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params: Record<string, string> = {};
      if (dealerFilter) params.dealerId = dealerFilter;
      if (statusFilter) params.status = statusFilter;
      const [recRes, summaryRes] = await Promise.all([
        apiClient.get("/api/v1/dealer-compliance", { params }),
        apiClient.get("/api/v1/dealer-compliance/summary"),
      ]);
      setRecords(recRes.data.records ?? []);
      setSummary(summaryRes.data.byStatus ?? {});
    } catch (error: any) {
      console.error("[DealerCompliancePage] failed to load compliance records:", error);
      setRecords([]);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load compliance records. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [dealerFilter, statusFilter]);

  useEffect(() => { loadDealers(); }, [loadDealers]);
  useEffect(() => { refresh(); }, [refresh]);

  const sendReminder = async (id: number) => {
    await apiClient.post(`/api/v1/dealer-compliance/${id}/remind`);
    await refresh();
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compliance & Renewals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dealer agreements, licenses, insurance and statutory NOCs — tracked to expiry.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4" /> Add / update record
        </Button>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
            className={`rounded-[var(--radius)] border p-3 text-left transition-colors ${statusFilter === s ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent"}`}
          >
            <div className="text-[11px] text-muted-foreground">{s.replace("_", " ")}</div>
            <div className="text-xl font-semibold">{summary[s] ?? 0}</div>
          </button>
        ))}
      </section>

      {showForm && (
        <ComplianceForm
          dealers={dealers}
          onDone={() => { setShowForm(false); refresh(); }}
        />
      )}

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={dealerFilter}
          onChange={(e) => setDealerFilter(e.target.value)}
          className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm"
        >
          <option value="">All dealers</option>
          {dealers.map((d) => <option key={d.id} value={d.id}>{d.tradeName || d.legalName}</option>)}
        </select>
      </section>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">Document</th>
              <th className="px-4 py-3 font-medium">Number</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : loadError ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[color:var(--zira-rejected)]">
                  {loadError}
                  <div className="mt-3">
                    <Button size="sm" variant="secondary" onClick={() => refresh()}>Retry</Button>
                  </div>
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No compliance records match these filters.</td></tr>
            ) : (
              records.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">{r.dealer?.tradeName || r.dealer?.legalName}</td>
                  <td className="px-4 py-3">{r.docType.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.docNumber ?? "—"}</td>
                  <td className="px-4 py-3">{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3"><Badge status={r.status} tone={STATUS_TONE[r.status] ?? "neutral"} /></td>
                  <td className="px-4 py-3 text-right">
                    {(r.status === "EXPIRED" || r.status === "EXPIRING_SOON") && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => sendReminder(r.id)}
                        title={r.reminderSentAt ? `Last reminded ${new Date(r.reminderSentAt).toLocaleDateString()}` : "Send renewal reminder"}
                      >
                        <BellRing className="h-3 w-3" /> Remind
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComplianceForm({ dealers, onDone }: { dealers: Dealer[]; onDone: () => void }) {
  const [form, setForm] = useState({ dealerId: "", docType: "DEALER_AGREEMENT", docNumber: "", issuedAt: "", expiresAt: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post("/api/v1/dealer-compliance", { ...form, dealerId: parseInt(form.dealerId) });
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not save record");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="compact" className="mb-6">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> Add or update a compliance record</h3>
      <p className="mb-3 text-xs text-muted-foreground">One record per dealer + document type — saving again updates the existing one.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <select value={form.dealerId} onChange={(e) => setForm({ ...form, dealerId: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          <option value="">Select dealer…</option>
          {dealers.map((d) => <option key={d.id} value={d.id}>{d.tradeName || d.legalName}</option>)}
        </select>
        <select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          {DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
        <input placeholder="Document number" value={form.docNumber} onChange={(e) => setForm({ ...form, docNumber: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input type="date" value={form.issuedAt} onChange={(e) => setForm({ ...form, issuedAt: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" title="Issued on" />
        <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" title="Expires on" />
      </div>
      {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      <div className="mt-3">
        <Button size="sm" disabled={saving || !form.dealerId} onClick={submit}>
          {saving ? "Saving…" : "Save record"}
        </Button>
      </div>
    </Card>
  );
}
