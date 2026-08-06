// ============================================================================
// Dealer Management — shared service logic
// ============================================================================
// Pure, dependency-light helpers used by the dealer-management controllers:
//   - nearest-dealer routing (state -> district -> pincode proximity)
//   - dealer-code generation (EVV-<STATE>-<SEQ>)
//   - ticket / request number generation
//   - the EV CRM product catalog (segments + models) for dropdowns
//   - target-vs-actual attainment maths
//   - segment (de)serialisation + compliance-expiry status (SQLite adaptations)
//
// SQLite adaptations vs. the original /api/services/dealerManagement.service.ts:
//   - `mode: "insensitive"` dropped from findNearestDealer's `equals` filter —
//     the SQLite connector doesn't support it (Postgres-only collation hint).
//     `contains` filters elsewhere are already case-insensitive on SQLite for
//     ASCII text, so those were left as-is in the adapted controllers.
//   - Dealer.segments is a comma-joined String column here (SQLite has no
//     native scalar-list type) — serializeSegments()/parseSegments() convert
//     to/from string[] at the controller boundary.
//   - generateSequenceNumber's prefix union widened to cover the new
//     inventory/warranty submodules (STR, WC).
// ============================================================================

import { prisma } from "@repo/db";

// ---------------------------------------------------------------------------
// EV CRM product catalog — drives segment dropdowns and finance/service
// vehicle-model pickers. Extend as the portfolio grows.
// ---------------------------------------------------------------------------
export const VEHICLE_SEGMENTS = ["L5", "L3", "CUSTOMISED"] as const;
export type VehicleSegment = (typeof VEHICLE_SEGMENTS)[number];

export const PRODUCT_CATALOG: Record<VehicleSegment, { model: string; application: string }[]> = {
  L5: [
    { model: "Vikas Lifter", application: "Heavy cargo / logistics" },
    { model: "Vikas Spark", application: "Premium city passenger" },
    { model: "Vikas Speedo", application: "Goods delivery / e-commerce" },
    { model: "Vikas Soorma", application: "Shared mobility / premium" },
    { model: "Vikas Nirmal", application: "Municipal waste / garbage" },
  ],
  L3: [
    { model: "Vikas Rani", application: "Daily commute passenger" },
    { model: "Vikas Loader", application: "Smart cargo loader" },
    { model: "Vikas Carry", application: "Closed-body delivery" },
    { model: "Vikas Swachh", application: "Urban sanitation (tipper)" },
  ],
  CUSTOMISED: [
    { model: "Vikas Foodcart", application: "Street food & beverages" },
    { model: "Vikas Nursery", application: "Mobile garden centre" },
    { model: "Vikas Dairy", application: "Cold / dairy transport" },
    { model: "Vikas Gas", application: "LPG cylinder distribution" },
    { model: "Vikas Mandi", application: "Mobile mandi" },
    { model: "Vikas Poultry", application: "Poultry transport" },
  ],
};

/** Flat list of every known model name (for validation / autocomplete). */
export const ALL_MODELS: string[] = Object.values(PRODUCT_CATALOG).flatMap((rows) =>
  rows.map((r) => r.model)
);

// ---------------------------------------------------------------------------
// Normalisation helpers — states/districts arrive in many spellings/cases.
// ---------------------------------------------------------------------------
export function normalizeRegion(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length > 10) d = d.slice(-10);
  return d.length === 10 ? d : null;
}

// ---------------------------------------------------------------------------
// Segment (de)serialisation — Dealer.segments is a comma-joined String on
// SQLite. Postgres deployments can drop these and use the native String[].
// ---------------------------------------------------------------------------
export function serializeSegments(segments: unknown): string {
  if (!Array.isArray(segments)) return "";
  return segments.filter((s) => typeof s === "string" && s.length > 0).join(",");
}

export function parseSegments(value?: string | null): string[] {
  if (!value) return [];
  return value.split(",").filter(Boolean);
}

// ---------------------------------------------------------------------------
// Nearest-dealer routing
// ---------------------------------------------------------------------------
// Strategy (best match wins):
//   1. exact (state + district) territory match
//   2. state-wide territory match (district = null)
//   3. any ACTIVE dealer in the same state
// Among equal matches we prefer: exclusive territory, then higher tier, then
// the dealer with the fewest open lead assignments (load balancing).
// Returns the chosen dealerId or null if nothing in that state.
// ---------------------------------------------------------------------------
export interface RoutingInput {
  state?: string | null;
  district?: string | null;
}

const TIER_RANK: Record<string, number> = {
  FLAGSHIP: 3,
  PREMIUM: 2,
  STANDARD: 1,
};

export async function findNearestDealer(input: RoutingInput): Promise<number | null> {
  const state = normalizeRegion(input.state);
  if (!state) return null;
  const district = normalizeRegion(input.district);

  // Pull candidate active dealers in the state with their territories and a
  // count of currently-open assignments (for load balancing).
  const candidates = await prisma.dealer.findMany({
    where: {
      status: "ACTIVE",
      state: { equals: input.state ?? undefined },
    },
    include: {
      territories: true,
      _count: {
        select: {
          leadAssignments: { where: { status: { in: ["ASSIGNED", "ACCEPTED", "CONTACTED"] } } },
        },
      },
    },
  });

  if (candidates.length === 0) return null;

  const scored = candidates.map((d) => {
    let territoryScore = 0;
    for (const t of d.territories) {
      const tState = normalizeRegion(t.state);
      const tDistrict = normalizeRegion(t.district);
      if (tState !== state) continue;
      if (district && tDistrict === district) {
        territoryScore = Math.max(territoryScore, t.exclusive ? 40 : 30); // exact district
      } else if (!tDistrict) {
        territoryScore = Math.max(territoryScore, t.exclusive ? 20 : 15); // whole state
      }
    }
    // Fallback: same-state dealer with no explicit territory row still counts.
    if (territoryScore === 0) territoryScore = 5;

    const tierScore = TIER_RANK[d.tier] ?? 1;
    const loadPenalty = d._count.leadAssignments; // fewer open = better

    return { dealerId: d.id, territoryScore, tierScore, loadPenalty };
  });

  scored.sort((a, b) => {
    if (b.territoryScore !== a.territoryScore) return b.territoryScore - a.territoryScore;
    if (b.tierScore !== a.tierScore) return b.tierScore - a.tierScore;
    return a.loadPenalty - b.loadPenalty;
  });

  return scored[0]?.dealerId ?? null;
}

// ---------------------------------------------------------------------------
// Code / number generators
// ---------------------------------------------------------------------------
const STATE_CODE: Record<string, string> = {
  "chhattisgarh": "CG",
  "madhya pradesh": "MP",
  "jharkhand": "JH",
  "bihar": "BR",
  "haryana": "HR",
  "delhi": "DL",
  "kashmir": "JK",
  "jammu and kashmir": "JK",
  "karnataka": "KA",
  "rajasthan": "RJ",
  "maharashtra": "MH",
  "uttar pradesh": "UP",
};

/** Turns a state name into a 2-letter code, falling back to first two letters. */
export function stateAbbrev(state?: string | null): string {
  const key = normalizeRegion(state);
  if (STATE_CODE[key]) return STATE_CODE[key];
  const letters = (state ?? "XX").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters.slice(0, 2) || "XX").padEnd(2, "X");
}

/** EVV-<STATE>-<zero-padded sequence>, unique per state. */
export async function generateDealerCode(state?: string | null): Promise<string> {
  const abbr = stateAbbrev(state);
  const countInState = await prisma.dealer.count({
    where: { dealerCode: { startsWith: `EVV-${abbr}-` } },
  });
  const seq = String(countInState + 1).padStart(3, "0");
  return `EVV-${abbr}-${seq}`;
}

/** Generic prefixed sequential number, e.g. SVC-2026-000123 / STR-2026-000045. */
export async function generateSequenceNumber(
  prefix: "SVC" | "SPR" | "STR" | "WC",
  countFn: () => Promise<number>
): Promise<string> {
  const year = new Date().getFullYear();
  const n = (await countFn()) + 1;
  return `${prefix}-${year}-${String(n).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Attainment maths — target vs actual
// ---------------------------------------------------------------------------
export interface Attainment {
  unitTarget: number;
  unitsSold: number;
  unitAttainmentPct: number; // 0..100+ (can exceed 100)
  revenueTarget: number | null;
  revenue: number;
  revenueAttainmentPct: number | null;
  conversionPct: number | null; // leadsConverted / leadsReceived
}

export function computeAttainment(
  target: { unitTarget: number; revenueTarget: number | null } | null,
  actual: {
    unitsSold: number;
    revenue: number;
    leadsReceived: number;
    leadsConverted: number;
  } | null
): Attainment {
  const unitTarget = target?.unitTarget ?? 0;
  const unitsSold = actual?.unitsSold ?? 0;
  const revenueTarget = target?.revenueTarget ?? null;
  const revenue = actual?.revenue ?? 0;
  const leadsReceived = actual?.leadsReceived ?? 0;
  const leadsConverted = actual?.leadsConverted ?? 0;

  return {
    unitTarget,
    unitsSold,
    unitAttainmentPct: unitTarget > 0 ? Math.round((unitsSold / unitTarget) * 100) : 0,
    revenueTarget,
    revenue,
    revenueAttainmentPct:
      revenueTarget && revenueTarget > 0 ? Math.round((revenue / revenueTarget) * 100) : null,
    conversionPct:
      leadsReceived > 0 ? Math.round((leadsConverted / leadsReceived) * 100) : null,
  };
}

/** First day of the current month at 00:00 (used as the canonical periodStart). */
export function currentPeriodStart(periodType: "MONTHLY" | "QUARTERLY" = "MONTHLY"): Date {
  const now = new Date();
  if (periodType === "QUARTERLY") {
    const q = Math.floor(now.getMonth() / 3) * 3;
    return new Date(now.getFullYear(), q, 1);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// ---------------------------------------------------------------------------
// Compliance expiry status — recomputed from expiresAt on every read/write
// so it never silently goes stale (see dealerCompliance.controller.ts).
// ---------------------------------------------------------------------------
export type ComplianceStatus = "VALID" | "EXPIRING_SOON" | "EXPIRED" | "MISSING";

export function computeComplianceStatus(expiresAt: Date | string | null | undefined): ComplianceStatus {
  if (!expiresAt) return "MISSING";
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const days = Math.floor((date.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "EXPIRED";
  if (days <= 30) return "EXPIRING_SOON";
  return "VALID";
}
