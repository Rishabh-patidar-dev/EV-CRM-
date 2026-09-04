// =============================================================================
// query.ts — safe parsing of list-endpoint query parameters.
// -----------------------------------------------------------------------------
// Two recurring problems this exists to solve:
//
// 1. UNBOUNDED READS. Several list endpoints called findMany() with no `take`,
//    so `GET /api/v1/<thing>` would serialize the entire table into one JSON
//    response. That is fine against seed data and catastrophic against a year
//    of production rows: it pins a CPU core in JSON.stringify, allocates the
//    whole result set on the heap, and blocks the event loop for every other
//    request on that worker while it happens.
//
// 2. UNVALIDATED SORT COLUMNS. The pattern
//        orderBy: { [req.query.sortBy]: req.query.sortOrder }
//    passes a client-controlled string straight into Prisma. It is not SQL
//    injection (Prisma parameterises), but `?sortBy=nonsense` becomes a 500,
//    and `?sortBy=<unindexed column>` is a free full-table sort for any caller
//    who wants to spend the database's CPU on their behalf.
//
// Both are now handled by whitelisting: a column not on the list falls back to
// the endpoint's default rather than reaching the database.
// =============================================================================
import type { Request } from "express";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

function firstValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

/**
 * Clamped page/limit. `limit` can never exceed MAX_PAGE_SIZE however large a
 * number the caller sends, so one request can never ask for the whole table.
 */
export function parsePagination(
  req: Request,
  { defaultLimit = DEFAULT_PAGE_SIZE, maxLimit = MAX_PAGE_SIZE }: { defaultLimit?: number; maxLimit?: number } = {}
): Pagination {
  const rawPage = Number.parseInt(firstValue(req.query.page) ?? "", 10);
  const rawLimit = Number.parseInt(firstValue(req.query.limit) ?? "", 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;

  return { page, limit, skip: (page - 1) * limit, take: limit };
}

/**
 * An orderBy clause built only from columns the endpoint declares sortable.
 *
 *   parseSort(req, ["createdAt", "legalName", "dealerCode"], "createdAt")
 */
export function parseSort<T extends string>(
  req: Request,
  sortable: readonly T[],
  fallback: T,
  fallbackOrder: "asc" | "desc" = "desc"
): Record<string, "asc" | "desc"> {
  const requested = firstValue(req.query.sortBy) as T | undefined;
  const column = requested && sortable.includes(requested) ? requested : fallback;
  const order = firstValue(req.query.sortOrder)?.toLowerCase() === "asc" ? "asc" : requested ? "desc" : fallbackOrder;
  return { [column]: order };
}

/**
 * A case-insensitive `contains` filter.
 *
 * This schema was originally developed against SQLite, where `contains` is
 * already case-insensitive for ASCII, so `mode: "insensitive"` was stripped
 * from the filters as unsupported. The database is now Postgres, where
 * `contains` maps to LIKE and *is* case-sensitive — which silently broke every
 * search box that had not been updated: searching "sample motors" stopped
 * matching "Sample Motors".
 */
export function containsInsensitive(value: string) {
  return { contains: value, mode: "insensitive" as const };
}

/** Trimmed search term, or undefined when the caller sent nothing useful. */
export function parseSearch(req: Request, param = "search"): string | undefined {
  const raw = firstValue(req.query[param])?.trim();
  if (!raw) return undefined;
  // A very long term is pure database cost for a result nobody wants.
  return raw.slice(0, 100);
}

/** Standard envelope so every paginated endpoint answers the same shape. */
export function paginated<T>(data: T[], total: number, { page, limit }: Pagination) {
  return {
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page * limit < total,
    },
  };
}
