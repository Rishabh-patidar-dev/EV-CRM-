// ============================================================================
// NEW SUBMODULE — Vehicle Inventory & Stock Allocation
// ----------------------------------------------------------------------------
// VehicleUnitController: VIN-level stock — OEM warehouse (dealerId = null)
// through allocation, demo fleet, and sale.
// StockTransferController: a dealer's request to pull more stock, with an
// optional fulfil() step that actually reassigns specific VIN units to the
// dealer when the transfer is marked DELIVERED.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { generateSequenceNumber } from "../services/dealerManagement.service.js";
import { registerComponentsForSale } from "../services/componentRegistration.service.js";

export class VehicleUnitController {
  // GET /api/v1/vehicle-units  (?dealerId=&status=&segment=&model=&search=&page=&limit=)
  async list(req: Request, res: Response) {
    try {
      const { dealerId, status, segment, model, search = "", page = "1", limit = "20" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string) || 20));

      const where: any = {};
      if (dealerId === "null") where.dealerId = null;
      else if (dealerId) where.dealerId = parseInt(dealerId as string);
      if (status) where.status = status;
      if (segment) where.segment = segment;
      if (model) where.model = model;
      if (search) {
        where.OR = [
          { vin: { contains: search as string } },
          { model: { contains: search as string } },
          { buyerName: { contains: search as string } },
        ];
      }

      const [units, total, byStatus] = await Promise.all([
        prisma.vehicleUnit.findMany({
          where,
          include: { dealer: { select: { id: true, dealerCode: true, legalName: true } } },
          orderBy: { createdAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.vehicleUnit.count({ where }),
        prisma.vehicleUnit.groupBy({ by: ["status"], _count: true, where: dealerId ? { dealerId: where.dealerId } : {} }),
      ]);

      res.json({
        units,
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      });
    } catch (error) {
      handleError(error, res, "List vehicle units");
    }
  }

  // GET /api/v1/vehicle-units/:id
  async getById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Unit ID is required", "id", "Get vehicle unit");
      const unit = await prisma.vehicleUnit.findUnique({
        where: { id },
        include: {
          dealer: { select: { id: true, dealerCode: true, legalName: true } },
          warrantyClaims: { orderBy: { createdAt: "desc" } },
        },
      });
      if (!unit) return handleNotFoundError(res, "Vehicle unit", "Get vehicle unit");
      res.json(unit);
    } catch (error) {
      handleError(error, res, "Get vehicle unit");
    }
  }

  // GET /api/v1/vehicle-units/analytics — the BI dashboard behind the inventory page:
  // current stock mix by model/status, plus dealer stock-transfer demand by
  // zone (dealer state) and by vehicle model, so a state's top-ordered model
  // is visible without inventing any new tracking beyond what already exists
  // on VehicleUnit / StockTransferRequest.
  async analytics(_req: Request, res: Response) {
    try {
      const [units, transfers, oemInStockRaw] = await Promise.all([
        prisma.vehicleUnit.findMany({ select: { model: true, status: true } }),
        prisma.stockTransferRequest.findMany({
          select: { model: true, quantity: true, dealer: { select: { state: true } } },
        }),
        // OEM warehouse stock actually available right now (dealerId = null,
        // IN_STOCK) — same definition Check Inventory uses — grouped by
        // model+segment for the image-gallery view on the inventory page.
        prisma.vehicleUnit.groupBy({ by: ["model", "segment"], where: { dealerId: null, status: "IN_STOCK" }, _count: true }),
      ]);

      const stockByStatus: Record<string, number> = {};
      const stockByModel: Record<string, number> = {};
      for (const u of units) {
        stockByStatus[u.status] = (stockByStatus[u.status] ?? 0) + 1;
        if (u.status !== "SOLD") stockByModel[u.model] = (stockByModel[u.model] ?? 0) + 1;
      }

      const ordersByZone: Record<string, number> = {};
      const ordersByModel: Record<string, number> = {};
      const zoneModel: Record<string, Record<string, number>> = {};
      for (const t of transfers) {
        const zone = t.dealer?.state ?? "Unknown";
        ordersByZone[zone] = (ordersByZone[zone] ?? 0) + t.quantity;
        ordersByModel[t.model] = (ordersByModel[t.model] ?? 0) + t.quantity;
        zoneModel[zone] = zoneModel[zone] ?? {};
        zoneModel[zone][t.model] = (zoneModel[zone][t.model] ?? 0) + t.quantity;
      }

      // For each zone, the single vehicle model it orders the most of —
      // the "zone order graph, vehicle-wise" the dashboard needs.
      const topModelByZone = Object.entries(zoneModel).map(([zone, models]) => {
        const [topModel, topQty] = Object.entries(models).sort((a, b) => b[1] - a[1])[0]!;
        return { zone, topModel, quantity: topQty, totalOrders: ordersByZone[zone] ?? 0 };
      }).sort((a, b) => b.totalOrders - a.totalOrders);

      const toSeries = (rec: Record<string, number>) =>
        Object.entries(rec).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

      const oemAvailableByModel = oemInStockRaw
        .map((r) => ({ model: r.model, segment: r.segment, quantity: r._count }))
        .sort((a, b) => b.quantity - a.quantity);

      res.json({
        stockByStatus,
        stockByModel: toSeries(stockByModel),
        ordersByZone: toSeries(ordersByZone),
        ordersByModel: toSeries(ordersByModel),
        topModelByZone,
        oemAvailableByModel,
        totalActiveStock: units.filter((u) => u.status !== "SOLD").length,
        totalUnits: units.length,
      });
    } catch (error) {
      handleError(error, res, "Vehicle inventory analytics");
    }
  }

  // POST /api/v1/vehicle-units — OEM registers a new unit (defaults to OEM warehouse stock)
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.vin || !b.model || !b.segment) {
        return handleValidationError(res, "vin, model and segment are required", "body", "Create vehicle unit");
      }
      const unit = await prisma.vehicleUnit.create({
        data: {
          vin: b.vin,
          model: b.model,
          segment: b.segment,
          color: b.color ?? null,
          status: b.status ?? "IN_STOCK",
          isDemoUnit: !!b.isDemoUnit,
          batteryHealthPct: b.batteryHealthPct ?? null,
          dealerId: b.dealerId ?? null,
          manufacturedAt: b.manufacturedAt ? new Date(b.manufacturedAt) : null,
          allocatedAt: b.dealerId ? new Date() : null,
          notes: b.notes ?? null,
        },
      });
      res.status(201).json(unit);
    } catch (error: any) {
      if (error.code === "P2002") return handleValidationError(res, "A unit with this VIN already exists", "vin", "Create vehicle unit");
      handleError(error, res, "Create vehicle unit");
    }
  }

  // PATCH /api/v1/vehicle-units/:id — move stock, mark sold/demo/service hold, etc.
  // A genuine OPEN->SOLD transition auto-registers ComponentUnit rows for the
  // model's warranty plans (see componentRegistration.service.ts) — the
  // vehicle-sale-to-warranty sync gap. Guarded on the *previous* status so
  // repeat PATCHes to an already-sold unit (e.g. editing notes) don't
  // re-register components.
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Unit ID is required", "id", "Update vehicle unit");
      const b = req.body ?? {};

      const current = await prisma.vehicleUnit.findUnique({ where: { id } });
      if (!current) return handleNotFoundError(res, "Vehicle unit", "Update vehicle unit");

      const data: any = {};
      for (const f of ["color", "status", "isDemoUnit", "batteryHealthPct", "notes", "invoiceNumber", "buyerName"]) {
        if (b[f] !== undefined) data[f] = b[f];
      }
      if (b.dealerId !== undefined) {
        data.dealerId = b.dealerId;
        if (b.dealerId) data.allocatedAt = new Date();
      }
      const becomingSold = b.status === "SOLD" && current.status !== "SOLD";
      if (becomingSold) data.soldAt = new Date();

      const unit = await prisma.$transaction(
        async (tx) => {
          const updated = await tx.vehicleUnit.update({ where: { id }, data });
          if (becomingSold) await registerComponentsForSale(tx, updated);
          return updated;
        },
        { timeout: 15000 }
      );
      res.json(unit);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Vehicle unit", "Update vehicle unit");
      handleError(error, res, "Update vehicle unit");
    }
  }
}

export class StockTransferController {
  // GET /api/v1/stock-transfers  (?dealerId=&status=)
  async list(req: Request, res: Response) {
    try {
      const { dealerId, status, page = "1", limit = "20" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));

      const where: any = {};
      if (dealerId) where.dealerId = parseInt(dealerId as string);
      if (status) where.status = status;

      const [items, total] = await Promise.all([
        prisma.stockTransferRequest.findMany({
          where,
          include: { dealer: { select: { id: true, dealerCode: true, legalName: true } } },
          orderBy: { createdAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.stockTransferRequest.count({ where }),
      ]);
      res.json({ transfers: items, pagination: { total, page: pageNum, limit: limitNum } });
    } catch (error) {
      handleError(error, res, "List stock transfers");
    }
  }

  // POST /api/v1/stock-transfers — dealer requests stock
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.dealerId || !b.model || !b.segment) {
        return handleValidationError(res, "dealerId, model and segment are required", "body", "Create stock transfer");
      }
      const requestNumber = await generateSequenceNumber("STR", () => prisma.stockTransferRequest.count());
      const transfer = await prisma.stockTransferRequest.create({
        data: {
          requestNumber,
          dealerId: parseInt(b.dealerId),
          model: b.model,
          segment: b.segment,
          quantity: b.quantity ?? 1,
          status: "REQUESTED",
          requestedById: (req as any).user?.id ?? null,
          notes: b.notes ?? null,
        },
      });
      res.status(201).json(transfer);
    } catch (error) {
      handleError(error, res, "Create stock transfer");
    }
  }

  // PATCH /api/v1/stock-transfers/:id
  //   body: { status, notes?, vehicleUnitIds? }
  //   When status -> DELIVERED and vehicleUnitIds are given, those VIN units
  //   are reassigned to the dealer (status ALLOCATED) in the same transaction.
  //   REQUESTED -> APPROVED and any DISPUTED transition must go through
  //   Order Management's Check Inventory / Disputed Orders endpoints
  //   (orderManagement.controller.ts) so an order can't be confirmed without
  //   a stock check ever running.
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Transfer ID is required", "id", "Update stock transfer");
      const b = req.body ?? {};

      const transfer = await prisma.stockTransferRequest.findUnique({ where: { id } });
      if (!transfer) return handleNotFoundError(res, "Stock transfer", "Update stock transfer");

      if (b.status !== undefined) {
        if (transfer.status === "REQUESTED" && b.status === "APPROVED") {
          return handleValidationError(res, "Run Check Inventory before approving a requested order", "status", "Update stock transfer");
        }
        if (b.status === "DISPUTED") {
          return handleValidationError(res, "Disputed status is only set by Check Inventory", "status", "Update stock transfer");
        }
        if (transfer.status === "DISPUTED") {
          return handleValidationError(res, "This order is disputed — use the Disputed Orders actions", "status", "Update stock transfer");
        }
      }

      const data: any = {};
      if (b.status) data.status = b.status;
      if (b.notes !== undefined) data.notes = b.notes;
      if (b.status === "DISPATCHED") data.dispatchedAt = new Date();
      if (b.status === "DELIVERED") data.deliveredAt = new Date();

      const vehicleUnitIds: number[] = Array.isArray(b.vehicleUnitIds) ? b.vehicleUnitIds : [];

      const updated = await prisma.$transaction(async (tx) => {
        if (b.status === "DELIVERED" && vehicleUnitIds.length > 0) {
          await tx.vehicleUnit.updateMany({
            where: { id: { in: vehicleUnitIds } },
            data: { dealerId: transfer.dealerId, status: "ALLOCATED", allocatedAt: new Date() },
          });
        }
        return tx.stockTransferRequest.update({ where: { id }, data });
      });

      res.json(updated);
    } catch (error) {
      handleError(error, res, "Update stock transfer");
    }
  }
}
