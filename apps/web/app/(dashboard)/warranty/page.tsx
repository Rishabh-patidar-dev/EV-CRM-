"use client";

// ============================================================================
// CENTREPIECE MODULE — Warranty Management
// ============================================================================
// Route: /warranty
// Coverage check → dealer claim intake → auto-adjudication → approval →
// reimbursement → supplier recovery. See DMS-and-Warranty-Research.pdf §4
// and apps/api/src/controllers/warranty.controller.ts.
// ============================================================================
import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ShieldPlus, Search, Plus, Loader2, CheckCircle2, XCircle,
  Battery,
} from "lucide-react";
import apiClient from "@/lib/api/client";

const COMPONENT_TYPES = ["BATTERY", "MOTOR", "CONTROLLER", "CHARGER", "CHASSIS", "BRAKES"];
const CLAIM_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "INFO_REQUESTED", "APPROVED", "IN_REPAIR", "REIMBURSED", "RECOVERY", "REJECTED", "CLOSED"];

const STATUS_BADGE: Record<string, string> = {
  SUBMITTED: "bg-secondary text-secondary-foreground",
  UNDER_REVIEW: "badge-pending",
  INFO_REQUESTED: "badge-pending",
  APPROVED: "badge-approved",
  IN_REPAIR: "badge-pending",
  REIMBURSED: "badge-approved",
  RECOVERY: "badge-pending",
  REJECTED: "badge-rejected",
  CLOSED: "bg-muted text-muted-foreground",
};

interface Dealer { id: number; dealerCode: string; legalName: string; tradeName?: string | null }

export default function WarrantyPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <WarrantyInner />
    </Suspense>
  );
}

function WarrantyInner() {
  const searchParams = useSearchParams();
  const dealerIdParam = searchParams.get("dealerId") ?? "";

  const [tab, setTab] = useState<"coverage" | "claims" | "plans" | "recovery">("claims");
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [pipeline, setPipeline] = useState<Record<string, number>>({});

  const loadPipeline = useCallback(async () => {
    const { data } = await apiClient.get("/api/v1/warranty-claims", { params: { limit: 1 } });
    setPipeline(data.pipeline ?? {});
  }, []);

  useEffect(() => {
    apiClient.get("/api/v1/dealers", { params: { limit: 100 } }).then((r) => setDealers(r.data.dealers ?? []));
    loadPipeline();
  }, [loadPipeline]);

  return (
    <div className="mx-auto max-w-[1500px] p-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldPlus className="h-6 w-6 text-primary" /> Warranty Management
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Component-serial coverage, dealer claim intake, auto-adjudication against policy, reimbursement, and supplier recovery — the closed loop.
        </p>
      </header>

      <section className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
        {CLAIM_STATUSES.map((s) => (
          <div key={s} className="rounded-[var(--radius)] border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.replace("_", " ")}</div>
            <div className="text-xl font-semibold tabular-nums">{pipeline[s] ?? 0}</div>
          </div>
        ))}
      </section>

      <div className="mb-4 flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "claims"} onClick={() => setTab("claims")}>Claims</TabButton>
        <TabButton active={tab === "coverage"} onClick={() => setTab("coverage")}>Coverage Check</TabButton>
        <TabButton active={tab === "plans"} onClick={() => setTab("plans")}>Warranty Plans</TabButton>
        <TabButton active={tab === "recovery"} onClick={() => setTab("recovery")}>Supplier Recovery</TabButton>
      </div>

      {tab === "claims" && <ClaimsTab dealers={dealers} onChanged={loadPipeline} initialDealerId={dealerIdParam} />}
      {tab === "coverage" && <CoverageTab />}
      {tab === "plans" && <PlansTab />}
      {tab === "recovery" && <RecoveryTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Coverage check
// ---------------------------------------------------------------------------
function CoverageTab() {
  const [identifier, setIdentifier] = useState("");
  const [result, setResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    if (!identifier.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await apiClient.get(`/api/v1/component-units/coverage/${encodeURIComponent(identifier.trim())}`);
      setResult(data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Nothing found for that VIN or serial number");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && check()}
            placeholder="Enter a chassis number (VIN) or component serial number…"
            className="w-full rounded-[var(--radius)] border border-border bg-card py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button onClick={check} disabled={loading} className="rounded-[var(--radius)] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
        </button>
      </div>

      {error && <div className="badge-rejected rounded-[var(--radius)] px-3 py-2 text-sm">{error}</div>}

      {result && (
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          {result.vehicle && (
            <div className="mb-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Vehicle</div>
              <div className="text-base font-semibold">{result.vehicle.model} · {result.vehicle.vin}</div>
            </div>
          )}
          <div className="space-y-3">
            {result.components.length === 0 ? (
              <p className="text-sm text-muted-foreground">No components registered against this vehicle yet.</p>
            ) : (
              result.components.map((c: any) => (
                <div key={c.serialNumber} className="flex items-center justify-between rounded-[var(--radius)] border border-border p-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Battery className="h-3.5 w-3.5 text-muted-foreground" /> {c.componentType}
                      <span className="font-mono text-xs text-muted-foreground">{c.serialNumber}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {c.plan ? `${c.plan.name} · ${c.plan.termMonths}mo${c.plan.termKm ? ` / ${c.plan.termKm}km` : ""}${c.plan.sohFloorPct ? ` · SoH floor ${c.plan.sohFloorPct}%` : ""}` : "No plan on file"}
                    </div>
                  </div>
                  <div className="text-right">
                    {c.inWarranty === null ? (
                      <span className="text-xs text-muted-foreground">Unknown</span>
                    ) : c.inWarranty ? (
                      <span className="badge-approved inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"><CheckCircle2 className="h-3 w-3" /> In warranty</span>
                    ) : (
                      <span className="badge-rejected inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"><XCircle className="h-3 w-3" /> Expired</span>
                    )}
                    {c.expiresAt && <div className="mt-1 text-[11px] text-muted-foreground">until {new Date(c.expiresAt).toLocaleDateString()}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------
function ClaimsTab({ dealers, onChanged, initialDealerId }: { dealers: Dealer[]; onChanged: () => void; initialDealerId?: string }) {
  const router = useRouter();
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [dealerFilter, setDealerFilter] = useState(initialDealerId ?? "");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: "50" };
      if (statusFilter) params.status = statusFilter;
      if (dealerFilter) params.dealerId = dealerFilter;
      const { data } = await apiClient.get("/api/v1/warranty-claims", { params });
      setClaims(data.claims ?? []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dealerFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={dealerFilter} onChange={(e) => setDealerFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All dealers</option>
          {dealers.map((d) => <option key={d.id} value={d.id}>{d.tradeName || d.legalName}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {CLAIM_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New claim
        </button>
      </div>

      {showForm && <NewClaimForm dealers={dealers} onDone={() => { setShowForm(false); load(); onChanged(); }} />}

      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Claim</th>
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : claims.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No warranty claims match these filters.</td></tr>
            ) : (
              claims.map((c) => (
                <tr key={c.id} onClick={() => router.push(`/warranty/claims/${c.id}`)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-xs">{c.claimNumber}</td>
                  <td className="px-4 py-3">{c.dealer?.tradeName || c.dealer?.legalName}</td>
                  <td className="px-4 py-3">{c.customerName}</td>
                  <td className="px-4 py-3"><span className={`${STATUS_BADGE[c.status] ?? "bg-muted"} rounded-full px-2 py-0.5 text-xs`}>{c.status.replace("_", " ")}</span></td>
                  <td className="px-4 py-3" />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewClaimForm({ dealers, onDone }: { dealers: Dealer[]; onDone: () => void }) {
  const [form, setForm] = useState({
    dealerId: "", customerName: "", customerPhone: "", issueDescription: "",
    vehicleUnitId: "", componentUnitId: "", odometerReading: "", measuredSohPct: "",
    chargerType: "", serviceRecordsComplete: true, claimAmount: "",
  });
  const [componentUnits, setComponentUnits] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get("/api/v1/component-units", { params: { limit: 100 } }).then((r) => setComponentUnits(r.data.componentUnits ?? []));
  }, []);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.post("/api/v1/warranty-claims", {
        ...form,
        vehicleUnitId: form.vehicleUnitId || undefined,
        componentUnitId: form.componentUnitId || undefined,
        odometerReading: form.odometerReading ? Number(form.odometerReading) : undefined,
        measuredSohPct: form.measuredSohPct ? Number(form.measuredSohPct) : undefined,
        claimAmount: form.claimAmount ? Number(form.claimAmount) : undefined,
      });
      setResult(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not create claim");
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <div className="mb-4 rounded-[var(--radius)] border border-primary/40 bg-card p-4 text-sm">
        <p className="font-medium">Claim {result.claimNumber} submitted — auto-adjudicated to <b>{result.status.replace("_", " ")}</b>.</p>
        <p className="mt-1 text-xs text-muted-foreground">{result.adjudication?.reasons?.join(" ")}</p>
        <ClaimDocumentUpload claimId={result.id} />
        <button onClick={onDone} className="mt-3 rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs hover:bg-accent">Done</button>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <select value={form.dealerId} onChange={(e) => setForm({ ...form, dealerId: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
          <option value="">Select dealer…</option>
          {dealers.map((d) => <option key={d.id} value={d.id}>{d.tradeName || d.legalName}</option>)}
        </select>
        <input placeholder="Customer name" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Customer phone" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <select value={form.componentUnitId} onChange={(e) => setForm({ ...form, componentUnitId: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm md:col-span-2">
          <option value="">No component serial linked</option>
          {componentUnits.map((c) => <option key={c.id} value={c.id}>{c.serialNumber} · {c.componentType} · {c.vehicleUnit?.vin ?? "unfitted"}</option>)}
        </select>
        <input placeholder="Odometer (km)" type="number" value={form.odometerReading} onChange={(e) => setForm({ ...form, odometerReading: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Measured SoH % (battery only)" type="number" value={form.measuredSohPct} onChange={(e) => setForm({ ...form, measuredSohPct: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Charger type used" value={form.chargerType} onChange={(e) => setForm({ ...form, chargerType: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <input placeholder="Claim amount (₹)" type="number" value={form.claimAmount} onChange={(e) => setForm({ ...form, claimAmount: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.serviceRecordsComplete} onChange={(e) => setForm({ ...form, serviceRecordsComplete: e.target.checked })} />
          Service records complete
        </label>
        <textarea placeholder="Issue description" value={form.issueDescription} onChange={(e) => setForm({ ...form, issueDescription: e.target.value })} className="col-span-2 rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm md:col-span-3" rows={2} />
      </div>
      {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      <div className="mt-3">
        <button disabled={saving || !form.dealerId || !form.customerName || !form.issueDescription} onClick={submit} className="rounded-[var(--radius)] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {saving ? "Submitting…" : "Submit claim (auto-adjudicated)"}
        </button>
      </div>
    </div>
  );
}

// Evidence upload — shown right after a claim is created, since that's
// when a service advisor has the photos/PDFs on hand. Separate endpoint
// from claim creation (POST /:id/documents) so the adjudication flow above
// doesn't need to change to accept multipart bodies.
function ClaimDocumentUpload({ claimId }: { claimId: number }) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      files.forEach((f) => body.append("files", f));
      const res = await apiClient.post(`/api/v1/warranty-claims/${claimId}/documents`, body, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setUploaded(res.data.documentPaths ?? []);
      setFiles([]);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mt-3 rounded-[var(--radius)] border border-dashed border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">Attach evidence (photos, service records)</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="file"
          multiple
          accept="image/*,application/pdf"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="text-xs"
        />
        <button
          onClick={upload}
          disabled={uploading || files.length === 0}
          className="rounded-[var(--radius)] bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {uploading ? "Uploading…" : `Upload ${files.length || ""}`}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
      {uploaded.length > 0 && (
        <p className="mt-1.5 text-xs" style={{ color: "var(--zira-approved)" }}>
          {uploaded.length} document{uploaded.length === 1 ? "" : "s"} attached.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
function PlansTab() {
  const [plans, setPlans] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", vehicleModel: "", componentType: "BATTERY", termMonths: "", termKm: "", sohFloorPct: "", approvedChargers: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await apiClient.get("/api/v1/warranty-plans");
    setPlans(data.plans ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setError(null);
    try {
      await apiClient.post("/api/v1/warranty-plans", {
        ...form,
        termMonths: Number(form.termMonths),
        termKm: form.termKm ? Number(form.termKm) : undefined,
        sohFloorPct: form.sohFloorPct ? Number(form.sohFloorPct) : undefined,
      });
      setShowForm(false);
      setForm({ name: "", vehicleModel: "", componentType: "BATTERY", termMonths: "", termKm: "", sohFloorPct: "", approvedChargers: "" });
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not create plan");
    }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> New plan
        </button>
      </div>
      {showForm && (
        <div className="mb-4 rounded-[var(--radius)] border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <input placeholder="Plan name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
            <input placeholder="Vehicle model (e.g. Vikas Lifter)" value={form.vehicleModel} onChange={(e) => setForm({ ...form, vehicleModel: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
            <select value={form.componentType} onChange={(e) => setForm({ ...form, componentType: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm">
              {COMPONENT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input placeholder="Term (months)" type="number" value={form.termMonths} onChange={(e) => setForm({ ...form, termMonths: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
            <input placeholder="Term (km, optional)" type="number" value={form.termKm} onChange={(e) => setForm({ ...form, termKm: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
            <input placeholder="SoH floor % (battery only)" type="number" value={form.sohFloorPct} onChange={(e) => setForm({ ...form, sohFloorPct: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm" />
            <input placeholder="Approved chargers, comma-separated" value={form.approvedChargers} onChange={(e) => setForm({ ...form, approvedChargers: e.target.value })} className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm md:col-span-2" />
          </div>
          {error && <p className="mt-2 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
          <button disabled={!form.name || !form.vehicleModel || !form.termMonths} onClick={submit} className="mt-3 rounded-[var(--radius)] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Create plan</button>
        </div>
      )}
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Model</th>
              <th className="px-4 py-3 font-medium">Component</th>
              <th className="px-4 py-3 font-medium">Term</th>
              <th className="px-4 py-3 font-medium">SoH floor</th>
            </tr>
          </thead>
          <tbody>
            {plans.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No warranty plans configured yet.</td></tr>
            ) : (
              plans.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">{p.name}</td>
                  <td className="px-4 py-3">{p.vehicleModel}</td>
                  <td className="px-4 py-3">{p.componentType}</td>
                  <td className="px-4 py-3">{p.termMonths}mo{p.termKm ? ` / ${p.termKm}km` : ""}</td>
                  <td className="px-4 py-3">{p.sohFloorPct ? `${p.sohFloorPct}%` : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supplier recovery
// ---------------------------------------------------------------------------
function RecoveryTab() {
  const [recoveries, setRecoveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get("/api/v1/supplier-recoveries");
      setRecoveries(data.recoveries ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: number, status: string) => {
    await apiClient.patch(`/api/v1/supplier-recoveries/${id}`, { status });
    load();
  };

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">Claim</th>
            <th className="px-4 py-3 font-medium">Dealer</th>
            <th className="px-4 py-3 font-medium">Supplier</th>
            <th className="px-4 py-3 font-medium">Component</th>
            <th className="px-4 py-3 font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
          ) : recoveries.length === 0 ? (
            <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No supplier recovery cases yet — these open automatically from a reimbursed claim.</td></tr>
          ) : (
            recoveries.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-xs">{r.claim?.claimNumber}</td>
                <td className="px-4 py-3">{r.claim?.dealer?.tradeName || r.claim?.dealer?.legalName}</td>
                <td className="px-4 py-3">{r.supplierName}</td>
                <td className="px-4 py-3">{r.componentType}</td>
                <td className="px-4 py-3">₹{Number(r.amount).toLocaleString("en-IN")}</td>
                <td className="px-4 py-3"><span className={`${r.status === "RECOVERED" ? "badge-approved" : r.status === "WRITTEN_OFF" ? "badge-rejected" : "badge-pending"} rounded-full px-2 py-0.5 text-xs`}>{r.status}</span></td>
                <td className="px-4 py-3 text-right">
                  {r.status === "OPEN" && (
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setStatus(r.id, "RECOVERED")} className="rounded border border-border px-2 py-1 text-xs hover:bg-accent">Recovered</button>
                      <button onClick={() => setStatus(r.id, "WRITTEN_OFF")} className="rounded border border-border px-2 py-1 text-xs hover:bg-accent">Write off</button>
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
