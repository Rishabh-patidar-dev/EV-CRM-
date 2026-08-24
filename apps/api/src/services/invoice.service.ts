// ============================================================================
// Invoice issuance — shared by Order Management (Check Inventory / Close
// Orders) and the dispatch/delivery status transitions on stock-transfer and
// spare-part requests (dealerInventory.controller.ts, dealerAfterSales
// .controller.ts). Pulled out of orderManagement.controller.ts so those two
// controllers don't have to reach across module boundaries for it.
//
// Every invoice snapshots price + quantity at issue time (see Invoice model
// comment in schema.prisma) — a later catalog price change or order edit
// must never retroactively alter an already-issued invoice.
// ============================================================================
import { prisma } from "@repo/db";
import { generateSequenceNumber, vehicleUnitPrice, DEFAULT_SPARE_PART_UNIT_PRICE } from "./dealerManagement.service.js";

export type OrderKind = "VEHICLE" | "SPARE_PART";
export type InvoiceType = "CONFIRMATION" | "OUT_OF_STOCK" | "PARTIAL" | "CANCELLATION" | "CUSTOM" | "DISPATCH" | "DELIVERY";

// Dealer fields an invoice needs to render as a real business document —
// name, GST/PAN for the "Bill To" block, phone/email so the PDF is a usable
// point of contact, not just an internal record.
export const DEALER_INVOICE_SELECT = {
  id: true, dealerCode: true, legalName: true, tradeName: true, state: true,
  phone: true, email: true, gstNumber: true, panNumber: true,
  addressLine: true, city: true, district: true, pincode: true,
} as const;

// Manufacturer's sale price for a spare part — catalogued price if set
// (non-zero), otherwise a flat fallback so a not-yet-priced part still
// shows a plausible total instead of ₹0.
async function sparePartUnitPrice(partCode: string | null | undefined, partName: string): Promise<number> {
  const inventory = partCode
    ? await prisma.sparePartInventory.findUnique({ where: { partCode } })
    : await prisma.sparePartInventory.findFirst({ where: { partName: { equals: partName, mode: "insensitive" } } });
  const price = inventory ? Number(inventory.unitPrice) : 0;
  return price > 0 ? price : DEFAULT_SPARE_PART_UNIT_PRICE;
}

/** Resolves the manufacturer's unit price for an order's item, vehicle or spare part. */
export async function resolveUnitPrice(type: OrderKind, order: { model?: string; partCode?: string | null; partName?: string }): Promise<number> {
  if (type === "VEHICLE") return vehicleUnitPrice(order.model!);
  return sparePartUnitPrice(order.partCode, order.partName!);
}

// The document Order Management hands the dealer, following the OEM's own
// flow chart: CONFIRMATION when stock covers the order, OUT_OF_STOCK/PARTIAL
// on a Close Orders notice, DISPATCH the moment an order leaves the
// warehouse, DELIVERY once the dealer has it in hand. Always called inside
// the same transaction as the status change it documents — `tx` must be the
// active transaction client, never the bare `prisma`.
export async function issueInvoice(
  tx: any,
  params: {
    type: OrderKind;
    orderId: number;
    dealerId: number;
    item: string;
    invoiceType: InvoiceType;
    requestedQuantity: number;
    fulfilledQuantity: number;
    unitPrice: number;
    expectedRestockDate?: Date | null;
    message?: string | null;
    issuedById: number | null;
  }
) {
  const invoiceNumber = await generateSequenceNumber("INV", () => tx.invoice.count());
  // fulfilledQuantity is a required, always-computed param here (0 is a
  // legitimate value — an OUT_OF_STOCK notice with nothing offered — so it
  // must NOT `||`-fall-back to requestedQuantity, or a zero-fulfillment
  // invoice would wrongly total the full requested amount.
  const totalAmount = params.unitPrice * params.fulfilledQuantity;
  return tx.invoice.create({
    data: {
      invoiceNumber,
      orderKind: params.type,
      stockTransferRequestId: params.type === "VEHICLE" ? params.orderId : null,
      sparePartRequestId: params.type === "SPARE_PART" ? params.orderId : null,
      dealerId: params.dealerId,
      type: params.invoiceType,
      item: params.item,
      requestedQuantity: params.requestedQuantity,
      fulfilledQuantity: params.fulfilledQuantity,
      unitPrice: params.unitPrice,
      totalAmount,
      expectedRestockDate: params.expectedRestockDate ?? null,
      message: params.message ?? null,
      issuedById: params.issuedById,
    },
    include: { dealer: { select: DEALER_INVOICE_SELECT } },
  });
}
