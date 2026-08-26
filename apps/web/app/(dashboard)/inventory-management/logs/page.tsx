"use client";

// ============================================================================
// Inventory Logs
// ============================================================================
// Route: /inventory-management/logs
// Audit trail of every event that moves vehicle or spare-part inventory
// between the OEM warehouse and a dealer — a delivered order moving stock
// OEM -> dealer, or a dealer manually adding / scanning-in stock in DMS.
// Read-only: GET /api/v1/inventory-logs (?entity=&bucket=&dealerId=&page=&limit=).
// ============================================================================
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ScrollText, Loader2, RefreshCw, ChevronLeft, ChevronRight, Car, PackageSearch } from "lucide-react";
import apiClient from "@/lib/api/client";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type Entity = "VEHICLE" | "SPARE_PART";
type Bucket = "DEALER" | "OEM";
type Direction = "ADDED" | "REMOVED";

interface DealerRef {
  id: number;
  dealerCode: string;
  legalName: string;
  tradeName: string | null;
}

interface LogRow {
  id: number;
  entity: Entity;
  bucket: Bucket;
  direction: Direction;
  quantity: number;
  itemLabel: string;
  dealerId: number | null;
  dealer: DealerRef | null;
  source: string;
  createdAt: string;
}

interface Dealer {
  id: number;
  dealerCode: string;
  legalName: string;
  tradeName?: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  ORDER_DELIVERED: "Order delivered",
  MANUAL_ADD: "Manual add",
  SCAN_BILL: "Scanned bill",
};

function humanizeSource(source: string): string {
  if (SOURCE_LABEL[source]) return SOURCE_LABEL[source];
  return source
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const ENTITY_META: Record<Entity, { label: string; tone: BadgeTone; icon: typeof Car }> = {
  VEHICLE: { label: "Vehicle", tone: "info", icon: Car },
  SPARE_PART: { label: "Spare Part", tone: "neutral", icon: PackageSearch },
};

function movementBadge(row: LogRow): { label: string; tone: BadgeTone } {
  const bucketLabel = row.bucket === "DEALER" ? "Dealer" : "OEM";
  if (row.direction === "ADDED") {
    return { label: `+${row.quantity} → ${bucketLabel}`, tone: "approved" };
  }
  return { label: `-${row.quantity} ← ${bucketLabel}`, tone: "rejected" };
}

export default function InventoryLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [entityFilter, setEntityFilter] = useState("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [dealerFilter, setDealerFilter] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    apiClient.get("/api/v1/dealers", { params: { limit: 200 } }).then(({ data }) => {
      setDealers(data.dealers ?? []);
    }).catch(() => {
      // dealer filter just stays empty — not worth blocking the page for
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params: Record<string, string> = { page: String(page), limit: "50" };
      if (entityFilter) params.entity = entityFilter;
      if (bucketFilter) params.bucket = bucketFilter;
      if (dealerFilter) params.dealerId = dealerFilter;
      const { data } = await apiClient.get("/api/v1/inventory-logs", { params });
      setLogs(data.logs ?? []);
      setPagination(data.pagination ?? { page: 1, limit: 50, total: 0, pages: 1 });
    } catch (error: any) {
      console.error("[InventoryLogsPage] failed to load inventory logs:", error);
      setLogs([]);
      setLoadError(error?.response?.data?.message || error?.message || "Could not load inventory logs. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [entityFilter, bucketFilter, dealerFilter, page]);

  useEffect(() => { load(); }, [load]);

  // Any filter change resets back to page 1 — a stale page number past the
  // end of a narrower result set would otherwise just render empty.
  const onEntityChange = (v: string) => { setEntityFilter(v); setPage(1); };
  const onBucketChange = (v: string) => { setBucketFilter(v); setPage(1); };
  const onDealerChange = (v: string) => { setDealerFilter(v); setPage(1); };

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ScrollText className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Inventory Logs</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every event that moved vehicle or spare-part stock — order deliveries, manual adds, scanned bills.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={entityFilter} onChange={(e) => onEntityChange(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
            <option value="">All entities</option>
            <option value="VEHICLE">Vehicles</option>
            <option value="SPARE_PART">Spare parts</option>
          </select>
          <select value={bucketFilter} onChange={(e) => onBucketChange(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
            <option value="">All buckets</option>
            <option value="DEALER">Dealer</option>
            <option value="OEM">OEM warehouse</option>
          </select>
          <select value={dealerFilter} onChange={(e) => onDealerChange(e.target.value)} className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm">
            <option value="">All dealers</option>
            {dealers.map((d) => (
              <option key={d.id} value={d.id}>{d.tradeName || d.legalName}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Movement</th>
              <th className="px-4 py-3 font-medium">Dealer</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : loadError ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[color:var(--zira-rejected)]">
                  {loadError}
                  <div className="mt-3">
                    <Button size="sm" variant="secondary" onClick={() => load()}>
                      <RefreshCw className="h-4 w-4" /> Retry
                    </Button>
                  </div>
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No inventory movements match these filters.</td></tr>
            ) : (
              logs.map((row) => {
                const entityMeta = ENTITY_META[row.entity];
                const EntityIcon = entityMeta.icon;
                const movement = movementBadge(row);
                return (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1">
                        <EntityIcon className="h-3 w-3" />
                        <Badge label={entityMeta.label} tone={entityMeta.tone} />
                      </span>
                    </td>
                    <td className="px-4 py-3">{row.itemLabel}</td>
                    <td className="px-4 py-3"><Badge label={movement.label} tone={movement.tone} /></td>
                    <td className="px-4 py-3">
                      {row.dealer ? (
                        <Link href={`/dealer-management/${row.dealer.id}`} className="hover:underline">
                          {row.dealer.tradeName || row.dealer.legalName}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{humanizeSource(row.source)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.quantity}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && !loadError && pagination.total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {pagination.total.toLocaleString("en-IN")} movement{pagination.total === 1 ? "" : "s"} &middot; page {pagination.page} of {pagination.pages}
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" disabled={pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Button>
            <Button size="sm" variant="secondary" disabled={pagination.page >= pagination.pages} onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}>
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
