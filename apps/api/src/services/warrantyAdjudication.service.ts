// ============================================================================
// Warranty adjudication rules engine — DMS-and-Warranty-Research.pdf
// Appendix B, implemented literally:
//   registration_date + term_years >= today          -> within time
//   odometer <= term_km                               -> within distance
//   measured_SoH < plan.soh_floor                      -> capacity claim valid
//   charger_type in plan.approved_chargers             -> not void
//   service_records_complete == true                   -> not void
//   no existing OPEN claim for same component           -> not duplicate
//
// "Clean claims flow straight through; only exceptions land on a human's
// desk" — so this returns AUTO_APPROVE only when every check that had
// enough evidence to run came back clean, VOID the moment any hard rule is
// broken, and NEEDS_REVIEW whenever evidence is missing or a soft flag
// (duplicate) is raised. Every check appends a plain-English reason so the
// claim's adjudicationNotes reads as "an evidenced decision, not an
// argument," per the brief.
// ============================================================================

const MS_PER_MONTH = 30.44 * 24 * 60 * 60 * 1000;

export interface AdjudicationPlan {
  termMonths: number;
  termKm: number | null;
  sohFloorPct: number | null;
  approvedChargers: string | null;
}

export interface AdjudicationClaim {
  odometerReading: number | null;
  measuredSohPct: number | null;
  chargerType: string | null;
  serviceRecordsComplete: boolean;
}

export interface AdjudicationInput {
  plan: AdjudicationPlan | null;
  componentRegisteredAt: Date | null;
  claim: AdjudicationClaim;
  hasOpenDuplicateClaim: boolean;
}

export type AdjudicationDecision = "AUTO_APPROVE" | "NEEDS_REVIEW" | "VOID";

export interface AdjudicationResult {
  decision: AdjudicationDecision;
  reasons: string[];
}

export function adjudicateClaim(input: AdjudicationInput): AdjudicationResult {
  const reasons: string[] = [];
  let voided = false;
  let needsReview = false;

  if (!input.plan) {
    return { decision: "NEEDS_REVIEW", reasons: ["No warranty plan on file for this vehicle model + component — routed for manual review."] };
  }
  const plan = input.plan;

  if (!input.componentRegisteredAt) {
    needsReview = true;
    reasons.push("No registration date on file for this component — cannot verify the time term.");
  } else {
    const monthsElapsed = (Date.now() - input.componentRegisteredAt.getTime()) / MS_PER_MONTH;
    if (monthsElapsed > plan.termMonths) {
      voided = true;
      reasons.push(`Outside time term: ${Math.floor(monthsElapsed)} months since registration vs. a ${plan.termMonths}-month cover.`);
    } else {
      reasons.push(`Within time term: ${Math.floor(monthsElapsed)} of ${plan.termMonths} months elapsed.`);
    }
  }

  if (plan.termKm != null) {
    if (input.claim.odometerReading == null) {
      needsReview = true;
      reasons.push("No odometer reading given — cannot verify the distance term.");
    } else if (input.claim.odometerReading > plan.termKm) {
      voided = true;
      reasons.push(`Outside distance term: ${input.claim.odometerReading}km vs. a ${plan.termKm}km cover.`);
    } else {
      reasons.push(`Within distance term: ${input.claim.odometerReading} of ${plan.termKm}km.`);
    }
  }

  if (plan.sohFloorPct != null) {
    if (input.claim.measuredSohPct == null) {
      needsReview = true;
      reasons.push(`Battery component (SoH floor ${plan.sohFloorPct}%) but no measured SoH given.`);
    } else if (input.claim.measuredSohPct >= plan.sohFloorPct) {
      voided = true;
      reasons.push(`Measured SoH ${input.claim.measuredSohPct}% is at or above the ${plan.sohFloorPct}% floor — not a valid capacity claim.`);
    } else {
      reasons.push(`Measured SoH ${input.claim.measuredSohPct}% is below the ${plan.sohFloorPct}% floor — capacity claim valid.`);
    }
  }

  if (plan.approvedChargers) {
    const approved = plan.approvedChargers.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (approved.length > 0) {
      if (!input.claim.chargerType) {
        needsReview = true;
        reasons.push("No charger type given — cannot confirm it's an approved accessory.");
      } else if (!approved.includes(input.claim.chargerType.trim().toLowerCase())) {
        voided = true;
        reasons.push(`Charger "${input.claim.chargerType}" is not on the approved list (${plan.approvedChargers}).`);
      } else {
        reasons.push(`Charger "${input.claim.chargerType}" is an approved accessory.`);
      }
    }
  }

  if (!input.claim.serviceRecordsComplete) {
    voided = true;
    reasons.push("Service records are incomplete.");
  } else {
    reasons.push("Service records complete.");
  }

  if (input.hasOpenDuplicateClaim) {
    needsReview = true;
    reasons.push("An open claim already exists for this exact component — flagged as a possible duplicate.");
  } else {
    reasons.push("No open duplicate claim for this component.");
  }

  if (voided) return { decision: "VOID", reasons };
  if (needsReview) return { decision: "NEEDS_REVIEW", reasons };
  return { decision: "AUTO_APPROVE", reasons };
}

// ----------------------------------------------------------------------------
// submitWarrantyClaim — the actual claim-creation + adjudication transaction,
// extracted so both the staff claim-intake endpoint
// (WarrantyClaimController.create) and the dealer-portal endpoint
// (DealerPortalController.createWarrantyClaim) run the exact same logic
// instead of two copies drifting apart.
// ----------------------------------------------------------------------------
import { prisma } from "@repo/db";
import { generateSequenceNumber } from "./dealerManagement.service.js";

export interface SubmitWarrantyClaimInput {
  dealerId: number;
  vehicleUnitId?: number | null;
  componentUnitId?: number | null;
  chassisNumber?: string | null;
  customerName: string;
  customerPhone?: string | null;
  issueDescription: string;
  odometerReading?: number | null;
  measuredSohPct?: number | null;
  chargerType?: string | null;
  serviceRecordsComplete?: boolean;
  claimAmount?: number | null;
  actorId?: number | null;
}

export async function submitWarrantyClaim(input: SubmitWarrantyClaimInput) {
  const componentUnit = input.componentUnitId
    ? await prisma.componentUnit.findUnique({ where: { id: input.componentUnitId }, include: { plan: true } })
    : null;

  const hasOpenDuplicateClaim = componentUnit
    ? (await prisma.warrantyClaim.count({
        where: {
          componentUnitId: componentUnit.id,
          status: { in: ["SUBMITTED", "UNDER_REVIEW", "INFO_REQUESTED", "APPROVED", "IN_REPAIR"] },
        },
      })) > 0
    : false;

  const adjudication = adjudicateClaim({
    plan: componentUnit?.plan
      ? {
          termMonths: componentUnit.plan.termMonths,
          termKm: componentUnit.plan.termKm,
          sohFloorPct: componentUnit.plan.sohFloorPct,
          approvedChargers: componentUnit.plan.approvedChargers,
        }
      : null,
    componentRegisteredAt: componentUnit?.registeredAt ?? null,
    claim: {
      odometerReading: input.odometerReading ?? null,
      measuredSohPct: input.measuredSohPct ?? null,
      chargerType: input.chargerType ?? null,
      serviceRecordsComplete: input.serviceRecordsComplete !== false,
    },
    hasOpenDuplicateClaim,
  });

  const initialStatus = adjudication.decision === "AUTO_APPROVE" ? "APPROVED" : adjudication.decision === "VOID" ? "REJECTED" : "UNDER_REVIEW";
  const claimNumber = await generateSequenceNumber("WC", () => prisma.warrantyClaim.count());

  const claim = await prisma.$transaction(async (tx) => {
    const created = await tx.warrantyClaim.create({
      data: {
        claimNumber,
        dealerId: input.dealerId,
        vehicleUnitId: input.vehicleUnitId ?? componentUnit?.vehicleUnitId ?? null,
        componentUnitId: componentUnit?.id ?? null,
        planId: componentUnit?.planId ?? null,
        chassisNumber: input.chassisNumber ?? null,
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        issueDescription: input.issueDescription,
        odometerReading: input.odometerReading ?? null,
        measuredSohPct: input.measuredSohPct ?? null,
        chargerType: input.chargerType ?? null,
        serviceRecordsComplete: input.serviceRecordsComplete !== false,
        claimAmount: input.claimAmount ?? null,
        approvedAmount: initialStatus === "APPROVED" ? input.claimAmount ?? null : null,
        status: initialStatus,
        voidReason: adjudication.decision === "VOID" ? adjudication.reasons.join(" ") : null,
        adjudicationNotes: adjudication.reasons.join(" "),
      },
    });
    await tx.warrantyClaimEvent.create({
      data: {
        claimId: created.id,
        fromStatus: null,
        toStatus: initialStatus,
        note: `Auto-adjudication: ${adjudication.decision}. ${adjudication.reasons.join(" ")}`,
        actorId: input.actorId ?? null,
      },
    });
    return created;
  });

  return { claim, adjudication };
}
