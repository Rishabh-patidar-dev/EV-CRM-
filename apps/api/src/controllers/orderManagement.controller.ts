// ============================================================================
// SUBMODULE — Order Management (manufacturer-wide view)
// ----------------------------------------------------------------------------
// Every order a dealer has raised against the manufacturer — vehicle stock
// (StockTransferRequest) and spare parts (SparePartRequest) — merged into one
// list and one BI dashboard, so the OEM side can see demand across the whole
// dealer network by zone (dealer state) and item, not just one dealer at a
// time (that per-dealer view already lives on the Dealer 360 detail page).
// No new tracking: both models already exist, this just aggregates them.
//
// Beyond the original zone/type/status/top-item breakdown, this also surfaces
// the operational signals a real order desk needs: how long orders have sat
// open (aging), which dealers actually drive volume, whether the network is
// keeping pace week over week, and how much of what's ordered actually gets
// delivered (fulfillment) rather than rejected or cancelled.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError } from "../utils/errorHandler.js";

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
}
