// ============================================================================
// Dealer Management — shared service logic
// ============================================================================
// Pure, dependency-light helpers used by the dealer-management controllers:
//   - nearest-dealer routing (state -> district -> pincode proximity)
//   - dealer-code generation (LGM-<STATE>-<SEQ>)
//   - ticket / request number generation
//   - the Luxus Green product catalog (segments + models) for dropdowns
//   - target-vs-actual attainment maths
// ============================================================================

import { prisma } from "@repo/db";

// ---------------------------------------------------------------------------
// Luxus Green product catalog — drives segment dropdowns and finance/service
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
      state: { equals: input.state ?? undefined, mode: "insensitive" },
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
};

/** Turns a state name into a 2-letter code, falling back to first two letters. */
export function stateAbbrev(state?: string | null): string {
  const key = normalizeRegion(state);
  if (STATE_CODE[key]) return STATE_CODE[key];
  const letters = (state ?? "XX").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters.slice(0, 2) || "XX").padEnd(2, "X");
}

/** LGM-<STATE>-<zero-padded sequence>, unique per state. */
export async function generateDealerCode(state?: string | null): Promise<string> {
  const abbr = stateAbbrev(state);
  const countInState = await prisma.dealer.count({
    where: { dealerCode: { startsWith: `LGM-${abbr}-` } },
  });
  const seq = String(countInState + 1).padStart(3, "0");
  return `LGM-${abbr}-${seq}`;
}

/** Generic prefixed sequential number, e.g. SVC-2026-000123 / SPR-2026-000045. */
export async function generateSequenceNumber(
  prefix: "SVC" | "SPR",
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
