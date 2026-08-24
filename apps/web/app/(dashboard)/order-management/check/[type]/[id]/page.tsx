"use client";

// ============================================================================
// Check Inventory
// ============================================================================
// Route: /order-management/check/[type]/[id]
// The step between a dealer's REQUESTED order and an actual order
// confirmation: compares the requested quantity against manufacturer stock
// (OEM warehouse VehicleUnit count for vehicles, SparePartInventory for
// spare parts) and lets staff run the check. Sufficient stock approves the
// order (the dealer's confirmation); short stock routes it to Close
// Orders instead — nothing is auto-approved without this page's decision.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, PackageCheck, PackageX, Warehouse, ClipboardList, CheckCircle2, AlertTriangle } from "lucide-react";
import apiClient from "@/lib/api/client";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface CheckResult {
  order: {
    id: number;
    type: "VEHICLE" | "SPARE_PART";
    orderNumber: string;
    status: string;
    dealer: { id: number; dealerCode: string; legalName: string; tradeName: string | null; state: string } | null;
    item: string;
    quantity: number;
  };
  requestedQuantity: number;
  availableQuantity: number;
  sufficient: boolean;
  notice: { status: string } | null;
}

export default function CheckInventoryPage() {
  const params = useParams();
  const router = useRouter();
  const type = String(params.type).toUpperCase();
  const id = Number(params.id);

  const [data, setData] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<{ sufficient: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get(`/api/v1/order-management/orders/${type}/${id}/check-inventory`);
      setData(data);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not load this order.");
    } finally {
      setLoading(false);
    }
  }, [type, id]);

  useEffect(() => { load(); }, [load]);

  const runCheck = async () => {
    setRunning(true);
    setError(null);
    try {
      const { data: result } = await apiClient.post(`/api/v1/order-management/orders/${type}/${id}/check-inventory`);
      setDecided({ sufficient: result.sufficient });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Could not run the inventory check.");
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-3xl p-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>;
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Link href="/order-management" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Order Management
        </Link>
        <p className="mt-6 rounded-[var(--radius)] border px-4 py-3 text-sm" style={{ borderColor: "var(--destructive)", color: "var(--destructive)" }}>{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { order, requestedQuantity, availableQuantity, sufficient } = data;
  const shortBy = Math.max(0, requestedQuantity - availableQuantity);
  const alreadyDecided = order.status !== "REQUESTED";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link href="/order-management" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Order Management
      </Link>

      <header className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">Check Inventory</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Comparing <span className="font-medium text-foreground">{order.orderNumber}</span> against manufacturer stock before it's confirmed.
        </p>
      </header>

      <Card padding="compact" className="mb-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Order</div>
            <div className="mt-0.5 font-mono text-xs">{order.orderNumber}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Dealer</div>
            <div className="mt-0.5">{order.dealer ? (order.dealer.tradeName || order.dealer.legalName) : "—"}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Zone</div>
            <div className="mt-0.5">{order.dealer?.state ?? "—"}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Item</div>
            <div className="mt-0.5">{order.item}</div>
          </div>
        </div>
      </Card>

      <section className="mb-4 grid grid-cols-2 gap-3">
        <StatCard icon={<ClipboardList className="h-3.5 w-3.5" />} label="Dealer requested" value={requestedQuantity} tone="blue" />
        <StatCard icon={<Warehouse className="h-3.5 w-3.5" />} label="Manufacturer available" value={availableQuantity} tone={sufficient ? "green" : "red"} />
      </section>

      <div
        className="mb-6 flex items-center gap-3 rounded-[var(--radius)] border p-4"
        style={
          sufficient
            ? { borderColor: "#1f9d55", backgroundColor: "color-mix(in srgb, #1f9d55 8%, transparent)" }
            : { borderColor: "var(--zira-rejected)", backgroundColor: "color-mix(in srgb, var(--zira-rejected) 8%, transparent)" }
        }
      >
        {sufficient ? <PackageCheck className="h-5 w-5 shrink-0" style={{ color: "#1f9d55" }} /> : <PackageX className="h-5 w-5 shrink-0" style={{ color: "var(--zira-rejected)" }} />}
        <div className="text-sm">
          {sufficient ? (
            <span><span className="font-semibold">Sufficient stock.</span> Running the check will confirm this order and set it to Approved.</span>
          ) : (
            <span><span className="font-semibold">Insufficient stock</span> — short by {shortBy}. Running the check will move this order to Close Orders; the dealer will not be confirmed until a notice is sent manually.</span>
          )}
        </div>
      </div>

      {error && <p className="mb-4 rounded-[var(--radius)] border px-3.5 py-2.5 text-sm" style={{ borderColor: "var(--destructive)", color: "var(--destructive)" }}>{error}</p>}

      {decided ? (
        <Card padding="compact" className="flex items-center gap-3">
          {decided.sufficient ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: "#1f9d55" }} />
          ) : (
            <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: "var(--zira-rejected)" }} />
          )}
          <div className="flex-1 text-sm">
            {decided.sufficient ? "Order confirmed — the dealer will see it as Approved." : "Moved to Close Orders — send an out-of-stock notice from there."}
          </div>
          <Link
            href={decided.sufficient ? "/order-management" : "/order-management/Close"}
            className="shrink-0 rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            {decided.sufficient ? "Back to Order Management" : "Go to Close Orders"}
          </Link>
        </Card>
      ) : alreadyDecided ? (
        <p className="text-sm text-muted-foreground">This order is already <span className="font-medium text-foreground">{order.status}</span> — no further action needed here.</p>
      ) : (
        <Button onClick={runCheck} disabled={running} className="w-full">
          {running ? "Checking…" : "Run inventory check"}
        </Button>
      )}
    </div>
  );
}
