// ============================================================================
// Sale -> warranty auto-registration
// ----------------------------------------------------------------------------
// The single biggest "not actually connected" gap found in the pre-build
// audit: marking a VehicleUnit SOLD never created the ComponentUnit rows
// that start the warranty clock — that was a fully separate manual step via
// POST /component-units. This closes it: called from
// VehicleUnitController#update on a genuine OPEN->SOLD transition.
//
// No serial-capture step exists at point of sale (VIN is the only hard
// identifier collected today), so real serials aren't known yet at this
// moment — an auto-generated placeholder is registered instead so the
// warranty clock (registeredAt) is still correct as of the actual sale date.
// The placeholder is corrected later via PATCH /component-units/:id once the
// real serial is known (see ComponentUnitController#update).
// ============================================================================
import { Prisma } from "@repo/db";

export async function registerComponentsForSale(
  tx: Prisma.TransactionClient,
  vehicleUnit: { id: number; model: string; vin: string }
) {
  const plans = await tx.warrantyPlan.findMany({
    where: { vehicleModel: vehicleUnit.model, isActive: true },
  });
  if (plans.length === 0) return [];

  const existing = await tx.componentUnit.findMany({
    where: { vehicleUnitId: vehicleUnit.id },
    select: { planId: true },
  });
  const alreadyRegisteredPlanIds = new Set(existing.map((c) => c.planId));
  const toCreate = plans.filter((p) => !alreadyRegisteredPlanIds.has(p.id));
  if (toCreate.length === 0) return [];

  const registeredAt = new Date();
  await tx.componentUnit.createMany({
    data: toCreate.map((plan) => ({
      serialNumber: `AUTO-${vehicleUnit.vin}-${plan.componentType}`,
      componentType: plan.componentType,
      vehicleUnitId: vehicleUnit.id,
      planId: plan.id,
      registeredAt,
    })),
  });
  return toCreate;
}
