// ============================================================================
// SUBMODULE — Purchase Management (manufacturer's own inbound stock)
// ----------------------------------------------------------------------------
// The OEM's own procurement: batches of vehicles purchased from a
// manufacturing plant / import source, tracked as a VehiclePurchaseOrder
// (Ordered -> In Transit -> Received, or Cancelled). "Sold" figures are read
// directly from VehicleUnit.status = SOLD — the real sales record already
// tracked by Vehicle Inventory — so imported vs. sold is a genuine
// cross-reference, not two halves of the same invented number.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";

async function generatePoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.vehiclePurchaseOrder.count();
  return `PO-${year}-${String(count + 1).padStart(6, "0")}`;
}

export class PurchaseManagementController {
  // GET /api/v1/purchase-management/orders  (?status=&model=&page=&limit=)
  async list(req: Request, res: Response) {
    try {
      const { status, model, page = "1", limit = "50" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string) || 50));

      const where: any = {};
      if (status) where.status = status;
      if (model) where.model = model;

      const [orders, total] = await Promise.all([
        prisma.vehiclePurchaseOrder.findMany({
          where,
          orderBy: { orderedAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.vehiclePurchaseOrder.count({ where }),
      ]);

      res.json({ orders, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
    } catch (error) {
      handleError(error, res, "List purchase orders");
    }
  }

  // POST /api/v1/purchase-management/orders
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.supplierName || !b.model || !b.segment || !b.quantity || b.unitCost == null) {
        return handleValidationError(res, "supplierName, model, segment, quantity and unitCost are required", "body", "Create purchase order");
      }
      const poNumber = await generatePoNumber();
      const order = await prisma.vehiclePurchaseOrder.create({
        data: {
          poNumber,
          supplierName: b.supplierName,
          model: b.model,
          segment: b.segment,
          quantity: parseInt(b.quantity),
          unitCost: Number(b.unitCost),
          expectedAt: b.expectedAt ? new Date(b.expectedAt) : null,
          notes: b.notes ?? null,
        },
      });
      res.status(201).json(order);
    } catch (error) {
      handleError(error, res, "Create purchase order");
    }
  }

  // PATCH /api/v1/purchase-management/orders/:id — body: { status }
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Order ID is required", "id", "Update purchase order");
      const status = req.body?.status;
      if (!status) return handleValidationError(res, "status is required", "status", "Update purchase order");

      const data: any = { status };
      if (status === "RECEIVED") data.receivedAt = new Date();

      const order = await prisma.vehiclePurchaseOrder.update({ where: { id }, data });
      res.json(order);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Purchase order", "Update purchase order");
      handleError(error, res, "Update purchase order");
    }
  }

  // GET /api/v1/purchase-management/analytics — imported vs. sold, by model,
  // purchase-order status mix, and total purchase spend on received stock.
  async analytics(_req: Request, res: Response) {
    try {
      const [orders, soldUnits] = await Promise.all([
        prisma.vehiclePurchaseOrder.findMany({
          select: { model: true, quantity: true, unitCost: true, status: true },
        }),
        prisma.vehicleUnit.findMany({
          where: { status: "SOLD" },
          select: { model: true },
        }),
      ]);

      const importedByModel: Record<string, number> = {};
      const soldByModel: Record<string, number> = {};
      const poStatusBreakdown: Record<string, number> = {};
      let totalOrderedQty = 0;
      let totalReceivedQty = 0;
      let totalSpend = 0;

      for (const o of orders) {
        poStatusBreakdown[o.status] = (poStatusBreakdown[o.status] ?? 0) + 1;
        if (o.status !== "CANCELLED") totalOrderedQty += o.quantity;
        if (o.status === "RECEIVED") {
          totalReceivedQty += o.quantity;
          totalSpend += o.quantity * Number(o.unitCost);
          importedByModel[o.model] = (importedByModel[o.model] ?? 0) + o.quantity;
        }
      }
      for (const u of soldUnits) {
        soldByModel[u.model] = (soldByModel[u.model] ?? 0) + 1;
      }

      const toSeries = (rec: Record<string, number>) =>
        Object.entries(rec).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

      res.json({
        totalOrderedQty,
        totalReceivedQty,
        totalSold: soldUnits.length,
        netStockMovement: totalReceivedQty - soldUnits.length,
        totalSpend,
        importedByModel: toSeries(importedByModel),
        soldByModel: toSeries(soldByModel),
        poStatusBreakdown: toSeries(poStatusBreakdown),
      });
    } catch (error) {
      handleError(error, res, "Purchase management analytics");
    }
  }
}
