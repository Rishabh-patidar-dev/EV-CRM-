// One append-only row per quantity movement — written inline in the same
// transaction as the mutation it documents (mirrors invoice.service.ts's
// issueInvoice: `tx` must be the active transaction client, never bare
// prisma, so a log entry can never exist without the stock change it
// describes actually having committed, or vice versa).
export type InventoryLogEntity = "VEHICLE" | "SPARE_PART";
export type InventoryLogBucket = "DEALER" | "OEM";
export type InventoryLogDirection = "ADDED" | "REMOVED";

export async function logInventoryChange(
  tx: any,
  params: {
    entity: InventoryLogEntity;
    bucket: InventoryLogBucket;
    direction: InventoryLogDirection;
    quantity: number;
    itemLabel: string;
    dealerId?: number | null;
    source: string;
  }
) {
  if (params.quantity <= 0) return;
  return tx.inventoryLog.create({
    data: {
      entity: params.entity,
      bucket: params.bucket,
      direction: params.direction,
      quantity: params.quantity,
      itemLabel: params.itemLabel,
      dealerId: params.dealerId ?? null,
      source: params.source,
    },
  });
}
