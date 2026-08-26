"use client";

// ============================================================================
// Spare Parts Inventory
// ============================================================================
// Route: /inventory-management/spare-parts
// OEM-level spare-part stock on hand — the manufacturer's own parts pool
// that dealer spare-part orders draw down against on delivery (see
// Order Management's DELIVERED handling, which decrements this same
// SparePartInventory table and logs the movement to Inventory Logs).
//
// Split out of the former combined /dealer-inventory page, where this used
// to be a "Spare parts on hand" strip beneath the vehicle gallery. Now its
// own full page.
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import { PackageSearch, Search, Loader2, RefreshCw, Boxes, PackageX } from "lucide-react";
import apiClient from "@/lib/api/client";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { useDeepLinkQuery } from "@/lib/useDeepLinkQuery";

interface SparePart {
  id: number;
  partName: string;
  partCode: string | null;
  quantityOnHand: number;
}

export default function SparePartsInventoryPage() {
  const deepLinkQ = useDeepLinkQuery();
  const [parts, setParts] = useState<SparePart[]>([]);
  const [search, setSearch] = useState(deepLinkQ);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      const { data } = await apiClient.get("/api/v1/spare-part-inventory", { params });
      setParts(data.items ?? []);
    } catch (error: any) {
      console.error("[SparePartsInventoryPage] failed to load spare part inventory:", error);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load spare part inventory. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  const totalParts = parts.length;
  const totalUnits = parts.reduce((sum, p) => sum + (p.quantityOnHand ?? 0), 0);
  const outOfStock = parts.filter((p) => (p.quantityOnHand ?? 0) === 0).length;

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <PackageSearch className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Spare Parts Inventory</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manufacturer-side spare-part stock on hand — the pool dealer spare-part orders draw against.
            </p>
          </div>
        </div>
        <div className="relative min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search part name or code…"
            className="w-full rounded-[var(--radius)] border border-border bg-card py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </header>

      {loadError && (
        <div className="mb-6 rounded-[var(--radius)] border border-dashed border-[color:var(--zira-rejected)]/40 p-4 text-center text-[color:var(--zira-rejected)]">
          {loadError}
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => load()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      )}

      {/* KPI row */}
      <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={<PackageSearch className="h-4 w-4" />} label="Distinct parts" value={totalParts} tone="teal" />
        <StatCard icon={<Boxes className="h-4 w-4" />} label="Units on hand" value={totalUnits.toLocaleString("en-IN")} tone="blue" />
        <StatCard icon={<PackageX className="h-4 w-4" />} label="Out of stock" value={outOfStock} tone={outOfStock > 0 ? "red" : "green"} />
      </section>

      {/* Gallery — same photo-less catalog treatment the vehicle gallery uses,
          just an icon tile since spare parts have no product photography. */}
      <section>
        <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Spare parts on hand</h2>
        {loading ? (
          <div className="py-16 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : parts.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {search ? "No spare parts match your search." : "No spare parts catalogued yet."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4 lg:grid-cols-6">
            {parts.map((p) => (
              <div key={p.id} className="flex flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/60">
                  <PackageSearch className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="mt-2 text-xs font-medium">{p.partName}</div>
                {p.partCode && <div className="text-[10px] text-muted-foreground">{p.partCode}</div>}
                <div className="mt-1 text-xl font-semibold tabular-nums">{p.quantityOnHand}</div>
                <div className="text-[11px] text-muted-foreground">in stock</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
