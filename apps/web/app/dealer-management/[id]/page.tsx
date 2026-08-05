"use client";

// ============================================================================
// Dealer 360 — dealer detail (full page)
// ============================================================================
// Route: /dealer-management/[id]
// Was a 420px side panel on the dealer list page; moved to its own full-width
// page so territory, attainment, OEM<->dealer orders (vehicle stock + spare
// parts, with inline status actions) and service tickets can all sit
// expanded at once instead of stacked in a narrow column.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Users, MapPin, Wallet, Wrench, Target as TargetIcon,
  TrendingUp, Package, Building2, Warehouse, ShieldCheck, ClipboardList, Truck, Mail, Phone,
} from "lucide-react";
import apiClient from "@/lib/api/client";

const STOCK_FLOW: Record<string, string> = { REQUESTED: "APPROVED", APPROVED: "DISPATCHED", DISPATCHED: "DELIVERED" };
const SPARE_FLOW: Record<string, string> = { REQUESTED: "APPROVED", APPROVED: "DISPATCHED", DISPATCHED: "DELIVERED" };

export default function DealerDetailPage() {
  const params = useParams();
  const dealerId = Number(params.id);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const res = await apiClient.get(`/api/v1/dealers/${dealerId}`);
    setData(res.data);
  }, [dealerId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiClient.get(`/api/v1/dealers/${dealerId}`)
      .then((res) => { if (active) setData(res.data); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dealerId]);

  const advanceStockTransfer = async (id: number, status: string) => {
    await apiClient.patch(`/api/v1/stock-transfers/${id}`, { status });
    await reload();
  };

  const advanceSparePart = async (id: number, status: string) => {
    await apiClient.patch(`/api/v1/spare-parts/${id}`, { status });
    await reload();
  };

  if (loading || !data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading dealer…</div>;
  }

  const att = data.currentAttainment ?? {};

  return (
    <div className="mx-auto max-w-[1600px] p-6">
      <Link href="/dealer-management" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to dealer list
      </Link>

      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-[var(--radius)] border border-border bg-card p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 shrink-0 text-primary" />
            <h1 className="truncate text-2xl font-semibold tracking-tight">{data.tradeName || data.legalName}</h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="font-mono text-xs">{data.dealerCode}</span>
            <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {data.city ? `${data.city}, ` : ""}{data.state}</span>
            {data.email && <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> {data.email}</span>}
            {data.phone && <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {data.phone}</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(data.segments ?? []).map((s: string) => (
              <span key={s} className="rounded-full border border-border px-2 py-0.5 text-xs">{s}</span>
            ))}
          </div>
        </div>

        {/* quick links into the other dealer-management submodules, pre-filtered */}
        <div className="flex flex-wrap gap-2">
          <QuickLink href={`/dealer-inventory?dealerId=${data.id}`} icon={<Warehouse className="w-3.5 h-3.5" />} label="Inventory" />
          <QuickLink href={`/dealer-compliance?dealerId=${data.id}`} icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Compliance" />
          <QuickLink href={`/warranty?dealerId=${data.id}`} icon={<ClipboardList className="w-3.5 h-3.5" />} label="Warranty" />
        </div>
      </header>

      {/* Summary row: attainment + territory + rollups, all visible at once */}
      <section className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <SectionTitle icon={<TargetIcon className="w-3.5 h-3.5" />}>This month</SectionTitle>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Metric label="Units" value={`${att.unitsSold ?? 0} / ${att.unitTarget ?? 0}`} sub={att.unitTarget ? `${att.unitAttainmentPct ?? 0}% of target` : "no target set"} />
            <Metric label="Conversion" value={att.conversionPct != null ? `${att.conversionPct}%` : "—"} sub="leads → sales" />
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <SectionTitle icon={<MapPin className="w-3.5 h-3.5" />}>Territory</SectionTitle>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(data.territories ?? []).length === 0 ? (
              <span className="text-xs text-muted-foreground">No territory assigned yet.</span>
            ) : (
              data.territories.map((t: any) => (
                <span key={t.id} className="rounded-[var(--radius)] border border-border px-2 py-0.5 text-xs">
                  {t.district ? `${t.district}, ${t.state}` : t.state}{t.exclusive ? " ★" : ""}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <RollupCard icon={<TrendingUp className="w-3.5 h-3.5" />} label="Routed leads" value={(data.leadAssignments ?? []).length} />
          <RollupCard icon={<Wallet className="w-3.5 h-3.5" />} label="Finance" value={(data.financeCases ?? []).length} />
          <RollupCard icon={<Package className="w-3.5 h-3.5" />} label="Spares" value={(data.sparePartRequests ?? []).length} />
        </div>
      </section>

      {/* OEM <-> Dealer orders — full lists with inline actions, side by side */}
      <section className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <SectionTitle icon={<Truck className="w-3.5 h-3.5" />}>Vehicle stock orders</SectionTitle>
          <ul className="mt-3 space-y-2">
            {(data.stockTransferRequests ?? []).map((t: any) => (
              <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{t.requestNumber} · {t.model} × {t.quantity}</span>
                <OrderStatusBadge status={t.status} />
                <OrderActions status={t.status} flow={STOCK_FLOW} onAdvance={(s) => advanceStockTransfer(t.id, s)} />
              </li>
            ))}
            {(data.stockTransferRequests ?? []).length === 0 && (
              <li className="text-xs text-muted-foreground">No vehicle stock orders raised yet.</li>
            )}
          </ul>
        </div>

        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <SectionTitle icon={<Package className="w-3.5 h-3.5" />}>Spare part orders</SectionTitle>
          <ul className="mt-3 space-y-2">
            {(data.sparePartRequests ?? []).map((s: any) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{s.requestNumber} · {s.partName} × {s.quantity}</span>
                <OrderStatusBadge status={s.status} />
                <OrderActions status={s.status} flow={SPARE_FLOW} onAdvance={(st) => advanceSparePart(s.id, st)} />
              </li>
            ))}
            {(data.sparePartRequests ?? []).length === 0 && (
              <li className="text-xs text-muted-foreground">No spare part orders raised yet.</li>
            )}
          </ul>
        </div>
      </section>

      {/* Vehicle allocation on hand */}
      <section className="mb-5 rounded-[var(--radius)] border border-border bg-card p-5">
        <SectionTitle icon={<Warehouse className="w-3.5 h-3.5" />}>Vehicle units allocated to this dealer</SectionTitle>
        <div className="mt-3 overflow-hidden rounded-[var(--radius)] border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">VIN</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Segment</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data.vehicleUnits ?? []).map((u: any) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{u.vin}</td>
                  <td className="px-3 py-2">{u.model}{u.isDemoUnit && <span className="ml-1.5 text-xs text-muted-foreground">(demo)</span>}</td>
                  <td className="px-3 py-2">{u.segment}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{u.status.replace("_", " ")}</td>
                </tr>
              ))}
              {(data.vehicleUnits ?? []).length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">No vehicle units allocated yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent service */}
      <section className="rounded-[var(--radius)] border border-border bg-card p-5">
        <SectionTitle icon={<Wrench className="w-3.5 h-3.5" />}>Recent service tickets</SectionTitle>
        <ul className="mt-3 space-y-1.5">
          {(data.serviceTickets ?? []).map((t: any) => (
            <li key={t.id} className="flex items-center justify-between text-sm">
              <span className="truncate mr-2">{t.ticketNumber} · {t.issue}</span>
              <span className="text-muted-foreground shrink-0">{t.status.replace("_", " ")}</span>
            </li>
          ))}
          {(data.serviceTickets ?? []).length === 0 && (
            <li className="text-xs text-muted-foreground">No tickets logged.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{icon}{children}</div>;
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function RollupCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-3">
      <div className="flex justify-center text-muted-foreground mb-1">{icon}</div>
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
    >
      {icon}
      {label}
    </Link>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const style = status === "DELIVERED" ? "badge-approved" : status === "REJECTED" || status === "CANCELLED" ? "badge-rejected" : "badge-pending";
  return <span className={`${style} shrink-0 rounded-full px-2 py-0.5 text-[10px]`}>{status.replace("_", " ")}</span>;
}

function OrderActions({ status, flow, onAdvance }: { status: string; flow: Record<string, string>; onAdvance: (status: string) => void }) {
  const next = flow[status];
  if (!next) return null;
  return (
    <button
      onClick={() => onAdvance(next)}
      className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-accent"
    >
      Mark {next.toLowerCase()}
    </button>
  );
}
