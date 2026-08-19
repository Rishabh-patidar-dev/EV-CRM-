// ============================================================================
// SUBMODULE — Order Management (manufacturer-wide view)
// ----------------------------------------------------------------------------
// Every order a dealer has raised against the manufacturer — vehicle stock
// (StockTransferRequest) and spare parts (SparePartRequest) — merged into one
// list and one BI dashboard, so the OEM side can see demand across the whole
// dealer network by zone (dealer state) and item, not just one dealer at a
// time (that per-dealer view already lives on the Dealer 360 detail page).
//
// Beyond the original zone/type/status/top-item breakdown, this also surfaces
// the operational signals a real order desk needs: how long orders have sat
// open (aging), which dealers actually drive volume, whether the network is
// keeping pace week over week, and how much of what's ordered actually gets
// delivered (fulfillment) rather than rejected or cancelled.
//
// It also owns the Check Inventory / Disputed Orders workflow: a REQUESTED
// order only becomes APPROVED (the dealer's order-confirmation) once staff
// run a stock comparison here. Short stock moves the order to DISPUTED and
// creates one OrderStockNotice row; the dealer sees nothing beyond "disputed"
// until staff manually send that notice with an expected restock date — that
// notice is the "out of stock invoice" the dealer eventually receives.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { generateSequenceNumber } from "../services/dealerManagement.service.js";

type OrderRow = {
  id: number;
  type: "VEHICLE" | "SPARE_PART";
  orderNumber: string;
  dealerId: number;
  dealer: { id: number; dealerCode: string; legalName: string; tradeName: string | null; state: string } | null;
  item: string;
  quantity: number;
  status: string;
  createdAt: Date;
};

const OPEN_STATUSES = new Set(["REQUESTED", "APPROVED", "DISPATCHED"]);
const RESOLVED_STATUSES = new Set(["DELIVERED", "REJECTED", "CANCELLED"]);
const DAY_MS = 86_400_000;

function dealerLabel(d: { tradeName: string | null; legalName: string } | null) {
  return d ? d.tradeName || d.legalName : "Unknown dealer";
}

type OrderKind = "VEHICLE" | "SPARE_PART";
const DEALER_SELECT = { id: true, dealerCode: true, legalName: true, tradeName: true, state: true } as const;

function normalizeType(raw: unknown): OrderKind | null {
  const t = String(raw ?? "").toUpperCase();
  return t === "VEHICLE" || t === "SPARE_PART" ? (t as OrderKind) : null;
}

// The dev-only demo login (auth.controller.ts's DEMO_FALLBACK) issues id 0,
// which has no matching users row — sentById/resolvedById are real foreign
// keys (unlike StockTransferRequest.requestedById, which is a plain int), so
// that id must never be written here or every notice send/resolve 500s under
// the demo login.
function actingUserId(req: Request): number | null {
  const id = (req as any).user?.id;
  return typeof id === "number" && id > 0 ? id : null;
}

function loadOrder(type: OrderKind, id: number) {
  return type === "VEHICLE"
    ? prisma.stockTransferRequest.findUnique({ where: { id }, include: { dealer: { select: DEALER_SELECT }, stockNotice: true } })
    : prisma.sparePartRequest.findUnique({ where: { id }, include: { dealer: { select: DEALER_SELECT }, stockNotice: true } });
}

// Manufacturer stock available for one order's item. Vehicles read live VIN
// counts — VehicleUnit.dealerId = null is OEM warehouse stock, the same
// convention dealerInventory.controller.ts already uses. Spare parts have no
// VIN-level truth, so they read SparePartInventory, matching by partCode
// first (exact) then partName (case-insensitive), auto-cataloguing an unseen
// part at 0 on hand rather than erroring.
async function computeAvailability(type: OrderKind, order: any): Promise<number> {
  if (type === "VEHICLE") {
    return prisma.vehicleUnit.count({
      where: { dealerId: null, status: "IN_STOCK", model: order.model, segment: order.segment },
    });
  }
  let inventory = order.partCode
    ? await prisma.sparePartInventory.findUnique({ where: { partCode: order.partCode } })
    : null;
  if (!inventory) {
    inventory = await prisma.sparePartInventory.findFirst({
      where: { partName: { equals: order.partName, mode: "insensitive" } },
    });
  }
  if (!inventory) {
    inventory = await prisma.sparePartInventory.create({
      data: { partCode: order.partCode ?? null, partName: order.partName, quantityOnHand: 0 },
    });
  }
  return inventory.quantityOnHand;
}

function itemLabel(type: OrderKind, order: any): string {
  return type === "VEHICLE" ? `${order.model} (${order.segment})` : order.partName;
}

// Identifies "the same shared stock pool" — vehicles by model+segment, spare
// parts by partCode (falling back to partName) — so Disputed Orders' best-fit
// sort only ever compares orders that are actually competing for the same
// units, not unrelated items that happen to both be short.
function groupKey(type: OrderKind, order: any): string {
  return type === "VEHICLE"
    ? `VEHICLE:${order.model}:${order.segment}`
    : `SPARE_PART:${String(order.partCode || order.partName).toLowerCase()}`;
}

// The document Order Management actually hands the dealer, following the
// OEM's own flow chart: CONFIRMATION when stock covers the order (issued the
// moment Check Inventory / a recheck approves it), OUT_OF_STOCK or PARTIAL
// when staff send a Disputed Orders notice (see sendNotice below). Always
// called inside the same transaction as the status change it documents —
// `tx` must be the active transaction client, never the bare `prisma`.
async function issueInvoice(
  tx: any,
  params: {
    type: OrderKind;
    orderId: number;
    dealerId: number;
    item: string;
    invoiceType: "CONFIRMATION" | "OUT_OF_STOCK" | "PARTIAL";
    requestedQuantity: number;
    fulfilledQuantity: number;
    expectedRestockDate?: Date | null;
    message?: string | null;
    issuedById: number | null;
  }
) {
  const invoiceNumber = await generateSequenceNumber("INV", () => tx.invoice.count());
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
      expectedRestockDate: params.expectedRestockDate ?? null,
      message: params.message ?? null,
      issuedById: params.issuedById,
    },
  });
}

export class OrderManagementController {
  // GET /api/v1/order-management/zones — one card per dealer state with an
  // open-order count and a "new from DMS" count (REQUESTED-status orders
  // the dealer placed themselves via the portal, not yet actioned by
  // staff — the badge self-clears the moment staff advances the status).
  async zones(_req: Request, res: Response) {
    try {
      const [transfers, spares] = await Promise.all([
        prisma.stockTransferRequest.findMany({
          select: { status: true, placedVia: true, dealer: { select: { state: true } } },
        }),
        prisma.sparePartRequest.findMany({
          select: { status: true, placedVia: true, dealer: { select: { state: true } } },
        }),
      ]);
      const all = [...transfers, ...spares];

      const zoneMap: Record<string, { openOrders: number; newFromDms: number }> = {};
      for (const o of all) {
        const zone = o.dealer?.state ?? "Unknown";
        zoneMap[zone] = zoneMap[zone] ?? { openOrders: 0, newFromDms: 0 };
        if (OPEN_STATUSES.has(o.status)) zoneMap[zone].openOrders++;
        if (o.status === "REQUESTED" && o.placedVia === "DMS") zoneMap[zone].newFromDms++;
      }

      const zones = Object.entries(zoneMap)
        .map(([zone, counts]) => ({ zone, ...counts }))
        .sort((a, b) => b.newFromDms - a.newFromDms || b.openOrders - a.openOrders);

      res.json({ zones });
    } catch (error) {
      handleError(error, res, "Order management zones");
    }
  }

  // GET /api/v1/order-management/orders
  //   ?zone=&status=&type=VEHICLE|SPARE_PART&dealerId=&page=&limit=
  async list(req: Request, res: Response) {
    try {
      const { zone, status, type, dealerId, page = "1", limit = "20" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string) || 20));

      const dealerWhere: any = {};
      if (zone) dealerWhere.state = zone;
      if (dealerId) dealerWhere.id = parseInt(dealerId as string);

      const [transfers, spares] = await Promise.all([
        type === "SPARE_PART" ? [] : prisma.stockTransferRequest.findMany({
          where: {
            ...(status ? { status: status as any } : {}),
            dealer: Object.keys(dealerWhere).length ? dealerWhere : undefined,
          },
          include: { dealer: { select: { id: true, dealerCode: true, legalName: true, tradeName: true, state: true } } },
          orderBy: { createdAt: "desc" },
        }),
        type === "VEHICLE" ? [] : prisma.sparePartRequest.findMany({
          where: {
            ...(status ? { status: status as any } : {}),
            dealer: Object.keys(dealerWhere).length ? dealerWhere : undefined,
          },
          include: { dealer: { select: { id: true, dealerCode: true, legalName: true, tradeName: true, state: true } } },
          orderBy: { createdAt: "desc" },
        }),
      ]);

      const merged: OrderRow[] = [
        ...transfers.map((t): OrderRow => ({
          id: t.id, type: "VEHICLE", orderNumber: t.requestNumber, dealerId: t.dealerId,
          dealer: t.dealer, item: `${t.model} (${t.segment})`, quantity: t.quantity,
          status: t.status, createdAt: t.createdAt,
        })),
        ...spares.map((s): OrderRow => ({
          id: s.id, type: "SPARE_PART", orderNumber: s.requestNumber, dealerId: s.dealerId,
          dealer: s.dealer, item: s.partName, quantity: s.quantity,
          status: s.status, createdAt: s.createdAt,
        })),
      ].sort((a, b) => +b.createdAt - +a.createdAt);

      const total = merged.length;
      const paged = merged.slice((pageNum - 1) * limitNum, pageNum * limitNum);

      res.json({ orders: paged, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
    } catch (error) {
      handleError(error, res, "List orders");
    }
  }

  // GET /api/v1/order-management/analytics — the manufacturer's order desk:
  // volume by zone/type/status, top item per zone, order aging, top dealers
  // by volume, a weekly trend, and fulfillment rate (overall + by zone).
  async analytics(_req: Request, res: Response) {
    try {
      const [transfers, spares] = await Promise.all([
        prisma.stockTransferRequest.findMany({
          select: { model: true, quantity: true, status: true, requestNumber: true, createdAt: true, dealerId: true, dealer: { select: { state: true, legalName: true, tradeName: true } } },
        }),
        prisma.sparePartRequest.findMany({
          select: { partName: true, quantity: true, status: true, requestNumber: true, createdAt: true, dealerId: true, dealer: { select: { state: true, legalName: true, tradeName: true } } },
        }),
      ]);

      const all = [
        ...transfers.map((t) => ({ type: "VEHICLE" as const, item: t.model, quantity: t.quantity, status: t.status, orderNumber: t.requestNumber, createdAt: t.createdAt, dealerId: t.dealerId, dealer: t.dealer })),
        ...spares.map((s) => ({ type: "SPARE_PART" as const, item: s.partName, quantity: s.quantity, status: s.status, orderNumber: s.requestNumber, createdAt: s.createdAt, dealerId: s.dealerId, dealer: s.dealer })),
      ];

      const ordersByZone: Record<string, number> = {};
      const ordersByStatus: Record<string, number> = {};
      const zoneVehicleModel: Record<string, Record<string, number>> = {};
      const zoneSparePart: Record<string, Record<string, number>> = {};
      const dealerVolume: Record<number, { name: string; zone: string; count: number }> = {};
      const zoneFulfillment: Record<string, { delivered: number; resolved: number }> = {};
      let vehicleOrders = 0;
      let sparePartOrders = 0;
      let openOrders = 0;
      let deliveredCount = 0;
      let resolvedCount = 0;
      let openAgeDaysSum = 0;

      const now = Date.now();
      const openOrdersDetailed: { type: string; orderNumber: string; dealer: string; zone: string; item: string; daysOpen: number; status: string }[] = [];

      for (const o of all) {
        const zone = o.dealer?.state ?? "Unknown";
        ordersByZone[zone] = (ordersByZone[zone] ?? 0) + o.quantity;
        ordersByStatus[o.status] = (ordersByStatus[o.status] ?? 0) + 1;

        if (o.type === "VEHICLE") {
          zoneVehicleModel[zone] = zoneVehicleModel[zone] ?? {};
          zoneVehicleModel[zone][o.item] = (zoneVehicleModel[zone][o.item] ?? 0) + o.quantity;
          vehicleOrders++;
        } else {
          zoneSparePart[zone] = zoneSparePart[zone] ?? {};
          zoneSparePart[zone][o.item] = (zoneSparePart[zone][o.item] ?? 0) + o.quantity;
          sparePartOrders++;
        }

        if (o.dealerId) {
          const key = o.dealerId;
          dealerVolume[key] = dealerVolume[key] ?? { name: dealerLabel(o.dealer), zone, count: 0 };
          dealerVolume[key].count++;
        }

        zoneFulfillment[zone] = zoneFulfillment[zone] ?? { delivered: 0, resolved: 0 };
        if (RESOLVED_STATUSES.has(o.status)) {
          resolvedCount++;
          zoneFulfillment[zone].resolved++;
          if (o.status === "DELIVERED") {
            deliveredCount++;
            zoneFulfillment[zone].delivered++;
          }
        }

        if (OPEN_STATUSES.has(o.status)) {
          openOrders++;
          const daysOpen = Math.floor((now - +o.createdAt) / DAY_MS);
          openAgeDaysSum += daysOpen;
          openOrdersDetailed.push({ type: o.type, orderNumber: o.orderNumber, dealer: dealerLabel(o.dealer), zone, item: o.item, daysOpen, status: o.status });
        }
      }

      const topByZone = (byZone: Record<string, Record<string, number>>) =>
        Object.entries(byZone).map(([zone, items]) => {
          const [topItem, qty] = Object.entries(items).sort((a, b) => b[1] - a[1])[0]!;
          return { zone, topItem, quantity: qty };
        }).sort((a, b) => b.quantity - a.quantity);

      const toSeries = (rec: Record<string, number>) =>
        Object.entries(rec).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

      // Weekly order volume — last 8 weeks, oldest first, so a bar chart reads left-to-right.
      const weeklyTrend: { label: string; value: number }[] = [];
      for (let i = 7; i >= 0; i--) {
        const weekStart = new Date(now - i * 7 * DAY_MS);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(+weekStart + 7 * DAY_MS);
        const count = all.filter((o) => +o.createdAt >= +weekStart && +o.createdAt < +weekEnd).length;
        weeklyTrend.push({ label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`, value: count });
      }

      const topDealersByVolume = Object.values(dealerVolume)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map((d) => ({ label: d.name, value: d.count, zone: d.zone }));

      const fulfillmentByZone = Object.entries(zoneFulfillment)
        .filter(([, f]) => f.resolved > 0)
        .map(([zone, f]) => {
          const rate = Math.round((f.delivered / f.resolved) * 100);
          return {
            zone,
            rate,
            statusLabel: rate >= 100 ? "Fully delivered" : rate >= 85 ? "On track" : `${f.resolved - f.delivered} lost to reject/cancel`,
          };
        })
        .sort((a, b) => b.rate - a.rate);

      res.json({
        totalOrders: vehicleOrders + sparePartOrders,
        vehicleOrders,
        sparePartOrders,
        openOrders,
        avgOpenOrderAgeDays: openOrders > 0 ? Math.round((openAgeDaysSum / openOrders) * 10) / 10 : 0,
        fulfillmentRate: resolvedCount > 0 ? Math.round((deliveredCount / resolvedCount) * 100) : null,
        ordersByZone: toSeries(ordersByZone),
        ordersByStatus: toSeries(ordersByStatus),
        ordersByType: [
          { label: "Vehicle stock", value: vehicleOrders },
          { label: "Spare parts", value: sparePartOrders },
        ],
        topVehicleModelByZone: topByZone(zoneVehicleModel),
        topSparePartByZone: topByZone(zoneSparePart),
        topDealersByVolume,
        weeklyTrend,
        fulfillmentByZone,
        oldestOpenOrders: openOrdersDetailed.sort((a, b) => b.daysOpen - a.daysOpen).slice(0, 6),
      });
    } catch (error) {
      handleError(error, res, "Order management analytics");
    }
  }

  // GET /api/v1/order-management/orders/:type/:id/check-inventory — side-
  // effect-free recompute, safe for staff to reopen an already-decided
  // order's page without re-triggering the decision.
  async getInventoryCheck(req: Request, res: Response) {
    try {
      const type = normalizeType(req.params.type);
      const id = parseInt(req.params.id as string);
      if (!type || !id) return handleValidationError(res, "A valid order type and id are required", "type", "Check inventory");

      const order: any = await loadOrder(type, id);
      if (!order) return handleNotFoundError(res, "Order", "Check inventory");

      const requestedQuantity = order.quantity;
      const availableQuantity = await computeAvailability(type, order);

      res.json({
        order: { id: order.id, type, orderNumber: order.requestNumber, status: order.status, dealer: order.dealer, item: itemLabel(type, order), quantity: order.quantity },
        requestedQuantity,
        availableQuantity,
        sufficient: availableQuantity >= requestedQuantity,
        notice: order.stockNotice ?? null,
      });
    } catch (error) {
      handleError(error, res, "Check inventory");
    }
  }

  // POST /api/v1/order-management/orders/:type/:id/check-inventory — the
  // actual "Check Inventory" button action, only valid on a REQUESTED order.
  // Sufficient stock -> APPROVED (the order confirmation). Short stock ->
  // DISPUTED + a new OrderStockNotice, routed into the Disputed Orders list.
  async runInventoryCheck(req: Request, res: Response) {
    try {
      const type = normalizeType(req.params.type);
      const id = parseInt(req.params.id as string);
      if (!type || !id) return handleValidationError(res, "A valid order type and id are required", "type", "Check inventory");

      const order: any = await loadOrder(type, id);
      if (!order) return handleNotFoundError(res, "Order", "Check inventory");
      if (order.status !== "REQUESTED") {
        return handleValidationError(res, "Only a REQUESTED order can be inventory-checked", "status", "Check inventory");
      }

      const requestedQuantity = order.quantity;
      const availableQuantity = await computeAvailability(type, order);
      const sufficient = availableQuantity >= requestedQuantity;

      const result = await prisma.$transaction(async (tx) => {
        if (sufficient) {
          const updated = type === "VEHICLE"
            ? await tx.stockTransferRequest.update({ where: { id }, data: { status: "APPROVED" } })
            : await tx.sparePartRequest.update({ where: { id }, data: { status: "APPROVED" } });
          const invoice = await issueInvoice(tx, {
            type, orderId: id, dealerId: order.dealerId, item: itemLabel(type, order),
            invoiceType: "CONFIRMATION", requestedQuantity, fulfilledQuantity: requestedQuantity,
            issuedById: actingUserId(req),
          });
          return { order: updated, notice: null, invoice };
        }

        const updated = type === "VEHICLE"
          ? await tx.stockTransferRequest.update({ where: { id }, data: { status: "DISPUTED" } })
          : await tx.sparePartRequest.update({ where: { id }, data: { status: "DISPUTED" } });

        const notice = await tx.orderStockNotice.create({
          data: {
            orderKind: type,
            stockTransferRequestId: type === "VEHICLE" ? id : null,
            sparePartRequestId: type === "SPARE_PART" ? id : null,
            requestedQuantity,
            availableQuantity,
            status: "OPEN",
          },
        });
        return { order: updated, notice };
      });

      res.json({ ...result, requestedQuantity, availableQuantity, sufficient });
    } catch (error) {
      handleError(error, res, "Check inventory");
    }
  }

  // GET /api/v1/order-management/disputed — the Disputed Orders sub-module
  // list: every VEHICLE + SPARE_PART order currently DISPUTED, merged same
  // as list(), with its stock notice attached, plus a "best fit" ranking:
  // orders competing for the same item (same model+segment, or same spare
  // part) are grouped and ranked by ascending shortfall against LIVE stock
  // (not the stale snapshot taken when the dispute was created), tie-broken
  // by largest quantity. Rank 0 in each group is what the "Sort: best fit"
  // button on the frontend surfaces first — the order closest to being fully
  // fulfillable from what's on hand right now.
  async listDisputed(req: Request, res: Response) {
    try {
      const { zone, type } = req.query;
      const dealerWhere: any = {};
      if (zone) dealerWhere.state = zone;
      const dealerFilter = Object.keys(dealerWhere).length ? dealerWhere : undefined;

      const [transfers, spares] = await Promise.all([
        type === "SPARE_PART" ? [] : prisma.stockTransferRequest.findMany({
          where: { status: "DISPUTED", dealer: dealerFilter },
          include: { dealer: { select: DEALER_SELECT }, stockNotice: true },
          orderBy: { updatedAt: "desc" },
        }),
        type === "VEHICLE" ? [] : prisma.sparePartRequest.findMany({
          where: { status: "DISPUTED", dealer: dealerFilter },
          include: { dealer: { select: DEALER_SELECT }, stockNotice: true },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

      const raw = [
        ...transfers.map((t) => ({
          id: t.id, type: "VEHICLE" as OrderKind, orderNumber: t.requestNumber, dealer: t.dealer,
          item: `${t.model} (${t.segment})`, quantity: t.quantity, status: t.status,
          notice: t.stockNotice, updatedAt: t.updatedAt, source: t as any,
        })),
        ...spares.map((s) => ({
          id: s.id, type: "SPARE_PART" as OrderKind, orderNumber: s.requestNumber, dealer: s.dealer,
          item: s.partName, quantity: s.quantity, status: s.status,
          notice: s.stockNotice, updatedAt: s.updatedAt, source: s as any,
        })),
      ];

      const groups = new Map<string, typeof raw>();
      for (const d of raw) {
        const key = groupKey(d.type, d.source);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(d);
      }

      const liveAvailableByGroup = new Map<string, number>();
      for (const [key, group] of groups) {
        liveAvailableByGroup.set(key, await computeAvailability(group[0].type, group[0].source));
      }

      const disputes: any[] = [];
      for (const [key, group] of groups) {
        const liveAvailable = liveAvailableByGroup.get(key)!;
        const ranked = [...group].sort((a, b) => {
          const shortA = Math.max(0, a.quantity - liveAvailable);
          const shortB = Math.max(0, b.quantity - liveAvailable);
          if (shortA !== shortB) return shortA - shortB;
          return b.quantity - a.quantity;
        });
        ranked.forEach(({ source: _source, ...d }, i) => {
          disputes.push({
            ...d,
            groupKey: key,
            liveAvailableQuantity: liveAvailable,
            shortfall: Math.max(0, d.quantity - liveAvailable),
            fulfillableNow: Math.min(d.quantity, liveAvailable),
            bestFitRank: i,
            recommended: i === 0 && group.length > 1,
          });
        });
      }
      disputes.sort((a, b) => +b.updatedAt - +a.updatedAt);

      res.json({ disputes, total: disputes.length });
    } catch (error) {
      handleError(error, res, "List disputed orders");
    }
  }

  // POST /api/v1/order-management/disputed/:type/:id/notice
  // body: { expectedRestockDate?, message?, offeredQuantity? } — the
  // out-of-stock notice the dealer only sees once staff send it manually;
  // this is the "invoice" the dealer receives in place of an order
  // confirmation. offeredQuantity is the partial-fulfillment offer ("we can
  // fulfil 155 of 160 now") — when set, the dealer can accept it from DMS,
  // which splits the order (see dealerPortal.controller.ts).
  async sendNotice(req: Request, res: Response) {
    try {
      const type = normalizeType(req.params.type);
      const id = parseInt(req.params.id as string);
      if (!type || !id) return handleValidationError(res, "A valid order type and id are required", "type", "Send out-of-stock notice");

      const order: any = await loadOrder(type, id);
      if (!order) return handleNotFoundError(res, "Order", "Send out-of-stock notice");
      if (order.status !== "DISPUTED" || !order.stockNotice) {
        return handleValidationError(res, "This order has no open dispute to send a notice for", "status", "Send out-of-stock notice");
      }

      const b = req.body ?? {};
      let offeredQuantity: number | null = null;
      if (b.offeredQuantity !== undefined && b.offeredQuantity !== null && b.offeredQuantity !== "") {
        offeredQuantity = parseInt(b.offeredQuantity);
        if (!Number.isFinite(offeredQuantity) || offeredQuantity <= 0 || offeredQuantity >= order.quantity) {
          return handleValidationError(res, "Offered quantity must be a positive number less than the requested quantity", "offeredQuantity", "Send out-of-stock notice");
        }
      }

      const expectedRestockDate = b.expectedRestockDate ? new Date(b.expectedRestockDate) : null;
      const message = b.message ?? null;
      const issuedById = actingUserId(req);

      const { notice, invoice } = await prisma.$transaction(async (tx) => {
        const notice = await tx.orderStockNotice.update({
          where: { id: order.stockNotice.id },
          data: {
            message,
            expectedRestockDate,
            offeredQuantity,
            dealerResponse: "PENDING",
            respondedAt: null,
            status: "SENT",
            sentById: issuedById,
            sentAt: new Date(),
          },
        });
        const invoice = await issueInvoice(tx, {
          type, orderId: id, dealerId: order.dealerId, item: itemLabel(type, order),
          invoiceType: offeredQuantity != null ? "PARTIAL" : "OUT_OF_STOCK",
          requestedQuantity: order.quantity, fulfilledQuantity: offeredQuantity ?? 0,
          expectedRestockDate, message, issuedById,
        });
        return { notice, invoice };
      });

      res.json({ ...notice, invoice });
    } catch (error) {
      handleError(error, res, "Send out-of-stock notice");
    }
  }

  // POST /api/v1/order-management/disputed/:type/:id/resolve — re-runs the
  // same comparison ("order renewal" recheck); sufficient stock now clears
  // the dispute back to APPROVED, otherwise the dispute stays open with a
  // refreshed available-quantity snapshot.
  async resolveDispute(req: Request, res: Response) {
    try {
      const type = normalizeType(req.params.type);
      const id = parseInt(req.params.id as string);
      if (!type || !id) return handleValidationError(res, "A valid order type and id are required", "type", "Resolve dispute");

      const order: any = await loadOrder(type, id);
      if (!order) return handleNotFoundError(res, "Order", "Resolve dispute");
      if (order.status !== "DISPUTED" || !order.stockNotice) {
        return handleValidationError(res, "This order has no open dispute", "status", "Resolve dispute");
      }

      const requestedQuantity = order.quantity;
      const availableQuantity = await computeAvailability(type, order);
      const sufficient = availableQuantity >= requestedQuantity;

      if (!sufficient) {
        const notice = await prisma.orderStockNotice.update({
          where: { id: order.stockNotice.id },
          data: { availableQuantity },
        });
        return res.json({ sufficient: false, availableQuantity, requestedQuantity, notice });
      }

      const issuedById = actingUserId(req);
      const { updatedOrder, notice, invoice } = await prisma.$transaction(async (tx) => {
        const updatedOrder = type === "VEHICLE"
          ? await tx.stockTransferRequest.update({ where: { id }, data: { status: "APPROVED" } })
          : await tx.sparePartRequest.update({ where: { id }, data: { status: "APPROVED" } });
        const notice = await tx.orderStockNotice.update({
          where: { id: order.stockNotice.id },
          data: { availableQuantity, status: "RESOLVED", resolvedById: issuedById, resolvedAt: new Date() },
        });
        const invoice = await issueInvoice(tx, {
          type, orderId: id, dealerId: order.dealerId, item: itemLabel(type, order),
          invoiceType: "CONFIRMATION", requestedQuantity, fulfilledQuantity: requestedQuantity,
          issuedById,
        });
        return { updatedOrder, notice, invoice };
      });

      res.json({ sufficient: true, availableQuantity, requestedQuantity, order: updatedOrder, notice, invoice });
    } catch (error) {
      handleError(error, res, "Resolve dispute");
    }
  }

  // GET /api/v1/order-management/invoices — the Invoices sub-module: every
  // CONFIRMATION / OUT_OF_STOCK / PARTIAL invoice Order Management has ever
  // issued, newest first. (?dealerId=&type=&orderType=VEHICLE|SPARE_PART)
  async listInvoices(req: Request, res: Response) {
    try {
      const { dealerId, type, orderType, page = "1", limit = "50" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string) || 50));

      const where: any = {};
      if (dealerId) where.dealerId = parseInt(dealerId as string);
      if (type) where.type = type;
      if (orderType) where.orderKind = orderType;

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          include: { dealer: { select: DEALER_SELECT } },
          orderBy: { issuedAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.invoice.count({ where }),
      ]);

      res.json({ invoices, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
    } catch (error) {
      handleError(error, res, "List invoices");
    }
  }
}
