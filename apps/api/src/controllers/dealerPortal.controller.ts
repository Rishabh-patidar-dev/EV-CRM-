// =============================================================================
// dealerPortal.controller.ts — DMS operational portal (dealer-facing)
// -----------------------------------------------------------------------------
// Every method here is mounted behind requireDealerPortalAuth, which resolves
// the dealer_session cookie to a Dealer row and stamps req.dealerPortal. Every
// write below forces dealerId from that context — a dealer can never act on
// another dealer's data, and can never spoof a dealerId in the request body.
//
// Deliberately NOT new business logic: these are dealer-scoped mirrors of the
// exact same Prisma writes the staff-only controllers already make
// (dealerInventory.controller.ts, dealerAfterSales.controller.ts,
// warranty.controller.ts) — a stock transfer / spare-part request / service
// ticket / warranty claim placed here is the same row type the CRM's Order
// Management, Vehicle Inventory, and Warranty pages already read. Nothing to
// sync; it's the same database.
// =============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { generateSequenceNumber, VEHICLE_CATALOG } from "../services/dealerManagement.service.js";
import { submitWarrantyClaim } from "../services/warrantyAdjudication.service.js";
import { segmentWhere } from "./campaignManagement.controller.js";
import { registerComponentsForSale } from "../services/componentRegistration.service.js";

// GST rule: e-way bills are mandatory (and here, only generatable) once a
// consignment's taxable value exceeds this statutory threshold.
const EWAY_BILL_THRESHOLD = 50000;

export class DealerPortalController {
  // GET /api/v1/dealer-portal/vehicle-catalog — the exact {model, segment}
  // pairs Check Inventory matches on, so the DMS order form's model dropdown
  // can never submit a value that doesn't exist in the real catalog (no more
  // typo'd/mismatched model names silently failing the stock comparison).
  async vehicleCatalog(_req: Request, res: Response) {
    res.json({ items: VEHICLE_CATALOG });
  }

  // GET /api/v1/dealer-portal/overview
  async overview(req: Request, res: Response) {
    try {
      const { dealerId, dealerCode, legalName, status } = req.dealerPortal!;
      const [
        vehicleCount, openTransfers, openSpareParts, openTickets, openClaims, openLeads,
        vehiclesByStatusRaw, leadsByStatusRaw, transferStatusRaw, sparePartStatusRaw, claimsByStatusRaw, ticketsByStatusRaw,
        soldUnits, invoicesByTypeRaw, activeUnits, totalLeads, convertedLeads, totalSoldCount, totalClaimsCount,
      ] = await Promise.all([
        prisma.vehicleUnit.count({ where: { dealerId } }),
        prisma.stockTransferRequest.count({ where: { dealerId, status: { in: ["REQUESTED", "APPROVED", "DISPATCHED"] } } }),
        prisma.sparePartRequest.count({ where: { dealerId, status: { in: ["REQUESTED", "APPROVED", "DISPATCHED"] } } }),
        prisma.serviceTicket.count({ where: { dealerId, status: { in: ["OPEN", "IN_PROGRESS", "AWAITING_PARTS"] } } }),
        prisma.warrantyClaim.count({ where: { dealerId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "INFO_REQUESTED", "APPROVED", "IN_REPAIR"] } } }),
        prisma.dealerLeadAssignment.count({ where: { dealerId, status: { in: ["ASSIGNED", "ACCEPTED", "CONTACTED"] } } }),
        prisma.vehicleUnit.groupBy({ by: ["status"], where: { dealerId }, _count: true }),
        prisma.dealerLeadAssignment.groupBy({ by: ["status"], where: { dealerId }, _count: true }),
        prisma.stockTransferRequest.groupBy({ by: ["status"], where: { dealerId }, _count: true }),
        prisma.sparePartRequest.groupBy({ by: ["status"], where: { dealerId }, _count: true }),
        prisma.warrantyClaim.groupBy({ by: ["status"], where: { dealerId }, _count: true }),
        prisma.serviceTicket.groupBy({ by: ["status"], where: { dealerId }, _count: true }),
        // Sales figures — no per-unit price is tracked anywhere in this
        // system, so "sales" here means unit counts (trend + top models),
        // not revenue.
        prisma.vehicleUnit.findMany({ where: { dealerId, status: "SOLD" }, select: { model: true, soldAt: true } }),
        prisma.invoice.groupBy({ by: ["type"], where: { dealerId }, _count: true }),
        // Dealer Performance Dashboard KPIs (per the ERP+DMS FRD's Module D8):
        // Days-in-Stock needs every non-sold unit's allocation date.
        prisma.vehicleUnit.findMany({ where: { dealerId, status: { not: "SOLD" } }, select: { allocatedAt: true, createdAt: true } }),
        prisma.dealerLeadAssignment.count({ where: { dealerId } }),
        prisma.dealerLeadAssignment.count({ where: { dealerId, status: "CONVERTED" } }),
        prisma.vehicleUnit.count({ where: { dealerId, status: "SOLD" } }),
        prisma.warrantyClaim.count({ where: { dealerId } }),
      ]);

      const toSeries = (rows: { status: string; _count: number }[]) =>
        rows.map((r) => ({ label: r.status.replace(/_/g, " "), value: r._count })).sort((a, b) => b.value - a.value);

      // Orders combines both order types into one status breakdown, same
      // "orders by status" shape the CRM's own Order Management page charts.
      const orderStatusCombined: Record<string, number> = {};
      for (const r of [...transferStatusRaw, ...sparePartStatusRaw]) {
        orderStatusCombined[r.status] = (orderStatusCombined[r.status] ?? 0) + r._count;
      }

      // Units sold per week, last 8 weeks — same weekly-trend pattern
      // Order Management's own analytics uses.
      const DAY_MS = 86_400_000;
      const now = Date.now();
      const salesTrend: { label: string; value: number }[] = [];
      for (let i = 7; i >= 0; i--) {
        const weekStart = new Date(now - i * 7 * DAY_MS);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(+weekStart + 7 * DAY_MS);
        const count = soldUnits.filter((u) => u.soldAt && +u.soldAt >= +weekStart && +u.soldAt < +weekEnd).length;
        salesTrend.push({ label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`, value: count });
      }

      const modelCounts: Record<string, number> = {};
      for (const u of soldUnits) modelCounts[u.model] = (modelCounts[u.model] ?? 0) + 1;
      const topModelsSold = Object.entries(modelCounts).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5);

      const invoicesByType = (invoicesByTypeRaw as any[])
        .map((r) => ({ label: r.type.replace(/_/g, " "), value: r._count }))
        .sort((a, b) => b.value - a.value);

      // Dealer Performance Dashboard KPIs — same definitions as FRD §13.8.
      const leadConversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 1000) / 10 : null;
      const avgDaysInStock = activeUnits.length > 0
        ? Math.round(activeUnits.reduce((sum, u) => sum + (Date.now() - +(u.allocatedAt ?? u.createdAt)) / DAY_MS, 0) / activeUnits.length)
        : null;
      const warrantyClaimRate = totalSoldCount > 0 ? Math.round((totalClaimsCount / totalSoldCount) * 1000) / 10 : null;

      res.json({
        dealer: { id: dealerId, dealerCode, legalName, status },
        vehicleCount,
        openTransfers,
        openSpareParts,
        openTickets,
        openClaims,
        openLeads,
        vehiclesByStatus: toSeries(vehiclesByStatusRaw as any),
        leadsByStatus: toSeries(leadsByStatusRaw as any),
        ordersByStatus: Object.entries(orderStatusCombined).map(([label, value]) => ({ label: label.replace(/_/g, " "), value })).sort((a, b) => b.value - a.value),
        claimsByStatus: toSeries(claimsByStatusRaw as any),
        ticketsByStatus: toSeries(ticketsByStatusRaw as any),
        salesTrend,
        topModelsSold,
        invoicesByType,
        leadConversionRate,
        avgDaysInStock,
        warrantyClaimRate,
      });
    } catch (error) {
      handleError(error, res, "Dealer portal overview");
    }
  }

  // GET /api/v1/dealer-portal/vehicle-units — this dealer's own allocated stock
  async listVehicleUnits(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const { status, page = "1", limit = "20" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
      const where: any = { dealerId };
      if (status) where.status = status;

      const [units, total, byStatusRaw] = await Promise.all([
        prisma.vehicleUnit.findMany({ where, orderBy: { createdAt: "desc" }, skip: (pageNum - 1) * limitNum, take: limitNum }),
        prisma.vehicleUnit.count({ where }),
        prisma.vehicleUnit.groupBy({ by: ["status"], where: { dealerId }, _count: true }),
      ]);
      const byStatus = byStatusRaw.map((r) => ({ label: r.status.replace(/_/g, " "), value: r._count })).sort((a, b) => b.value - a.value);
      res.json({ units, byStatus, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
    } catch (error) {
      handleError(error, res, "List dealer vehicle units");
    }
  }

  // GET /api/v1/dealer-portal/stock-transfers
  async listStockTransfers(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const transfers = await prisma.stockTransferRequest.findMany({ where: { dealerId }, include: { stockNotice: true }, orderBy: { createdAt: "desc" }, take: 100 });
      res.json({ transfers });
    } catch (error) {
      handleError(error, res, "List dealer stock transfers");
    }
  }

  // POST /api/v1/dealer-portal/stock-transfers — dealer places a vehicle stock order
  async createStockTransfer(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.model || !b.segment) {
        return handleValidationError(res, "model and segment are required", "body", "Place vehicle order");
      }
      const requestNumber = await generateSequenceNumber("STR", () => prisma.stockTransferRequest.count());
      const transfer = await prisma.stockTransferRequest.create({
        data: {
          requestNumber,
          dealerId,
          model: b.model,
          segment: b.segment,
          quantity: b.quantity ? parseInt(b.quantity) : 1,
          notes: b.notes ?? null,
          placedVia: "DMS",
        },
      });
      res.status(201).json(transfer);
    } catch (error) {
      handleError(error, res, "Place vehicle order");
    }
  }

  // GET /api/v1/dealer-portal/spare-parts
  async listSpareParts(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const spareParts = await prisma.sparePartRequest.findMany({ where: { dealerId }, include: { stockNotice: true }, orderBy: { createdAt: "desc" }, take: 100 });
      res.json({ spareParts });
    } catch (error) {
      handleError(error, res, "List dealer spare-part requests");
    }
  }

  // POST /api/v1/dealer-portal/spare-parts — dealer places a spare-part order
  async createSparePart(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.partName) {
        return handleValidationError(res, "partName is required", "partName", "Place spare-part order");
      }
      const requestNumber = await generateSequenceNumber("SPR", () => prisma.sparePartRequest.count());
      const sparePart = await prisma.sparePartRequest.create({
        data: {
          requestNumber,
          dealerId,
          partName: b.partName,
          partCode: b.partCode ?? null,
          quantity: b.quantity ? parseInt(b.quantity) : 1,
          placedVia: "DMS",
        },
      });
      res.status(201).json(sparePart);
    } catch (error) {
      handleError(error, res, "Place spare-part order");
    }
  }

  // GET /api/v1/dealer-portal/invoices — every CONFIRMATION / OUT_OF_STOCK /
  // PARTIAL invoice Order Management has issued this dealer, newest first.
  async listInvoices(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const invoices = await prisma.invoice.findMany({ where: { dealerId }, orderBy: { issuedAt: "desc" }, take: 100 });
      res.json({ invoices });
    } catch (error) {
      handleError(error, res, "List dealer invoices");
    }
  }

  // POST /api/v1/dealer-portal/stock-transfers/:id/notice-response
  // POST /api/v1/dealer-portal/spare-parts/:id/notice-response
  //   body: { response: "ACCEPTED" | "DECLINED" }
  // Dealer's reply to a partial-fulfillment offer ("we can fulfil 155 of
  // 160 now"). ACCEPTED splits the order: the original is cut down to the
  // offered quantity and approved now, and a fresh REQUESTED backorder
  // covers the remainder so that demand isn't silently lost. DECLINED just
  // records the answer — the order stays DISPUTED for staff to reconsider.
  async respondToStockTransferNotice(req: Request, res: Response) {
    return this.respondToNotice(req, res, {
      findOrder: (id) => prisma.stockTransferRequest.findUnique({ where: { id }, include: { stockNotice: true } }),
      updateOrderQuantityAndApprove: (tx, id, quantity) => tx.stockTransferRequest.update({ where: { id }, data: { quantity, status: "APPROVED" } }),
      createBackorder: (tx, order: any, quantity: number, requestNumber: string) =>
        tx.stockTransferRequest.create({
          data: {
            requestNumber, dealerId: order.dealerId, model: order.model, segment: order.segment, quantity,
            status: "REQUESTED", placedVia: "DMS",
            notes: `Backorder split from ${order.requestNumber} — ${order.quantity - quantity}/${order.quantity} accepted now.`,
          },
        }),
      sequencePrefix: "STR",
      countBackorders: (tx) => tx.stockTransferRequest.count(),
    });
  }

  async respondToSparePartNotice(req: Request, res: Response) {
    return this.respondToNotice(req, res, {
      findOrder: (id) => prisma.sparePartRequest.findUnique({ where: { id }, include: { stockNotice: true } }),
      updateOrderQuantityAndApprove: (tx, id, quantity) => tx.sparePartRequest.update({ where: { id }, data: { quantity, status: "APPROVED" } }),
      createBackorder: (tx, order: any, quantity: number, requestNumber: string) =>
        tx.sparePartRequest.create({
          data: {
            requestNumber, dealerId: order.dealerId, partName: order.partName, partCode: order.partCode, quantity,
            status: "REQUESTED", placedVia: "DMS",
            notes: `Backorder split from ${order.requestNumber} — ${order.quantity - quantity}/${order.quantity} accepted now.`,
          },
        }),
      sequencePrefix: "SPR",
      countBackorders: (tx) => tx.sparePartRequest.count(),
    });
  }

  // All three mutating ops below take `tx` (the active transaction client)
  // explicitly — earlier drafts of this closed over the outer `prisma`
  // instead, which silently ran the order-split outside the transaction
  // that resolves the notice, breaking atomicity. Every write here must go
  // through the same `tx`.
  private async respondToNotice(
    req: Request,
    res: Response,
    ops: {
      findOrder: (id: number) => Promise<any>;
      updateOrderQuantityAndApprove: (tx: any, id: number, quantity: number) => Promise<any>;
      createBackorder: (tx: any, order: any, quantity: number, requestNumber: string) => Promise<any>;
      sequencePrefix: "STR" | "SPR";
      countBackorders: (tx: any) => Promise<number>;
    }
  ) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const response = String(req.body?.response ?? "").toUpperCase();
      if (!id || (response !== "ACCEPTED" && response !== "DECLINED")) {
        return handleValidationError(res, "response must be ACCEPTED or DECLINED", "response", "Respond to out-of-stock notice");
      }

      const order = await ops.findOrder(id);
      if (!order || order.dealerId !== dealerId) return handleNotFoundError(res, "Order", "Respond to out-of-stock notice");
      const notice = order.stockNotice;
      if (order.status !== "DISPUTED" || !notice || notice.status !== "SENT" || notice.dealerResponse !== "PENDING" || notice.offeredQuantity == null) {
        return handleValidationError(res, "This order has no pending partial-fulfillment offer to respond to", "status", "Respond to out-of-stock notice");
      }

      if (response === "DECLINED") {
        const updatedNotice = await prisma.orderStockNotice.update({
          where: { id: notice.id },
          data: { dealerResponse: "DECLINED", respondedAt: new Date() },
        });
        return res.json({ order, notice: updatedNotice, backorder: null });
      }

      const offeredQuantity: number = notice.offeredQuantity;
      const remaining = order.quantity - offeredQuantity;

      const [updatedOrder, updatedNotice, backorder] = await prisma.$transaction(async (tx) => {
        const nextOrder = await ops.updateOrderQuantityAndApprove(tx, id, offeredQuantity);
        const nextNotice = await tx.orderStockNotice.update({
          where: { id: notice.id },
          data: { dealerResponse: "ACCEPTED", respondedAt: new Date(), status: "RESOLVED", resolvedAt: new Date() },
        });
        let nextBackorder = null;
        if (remaining > 0) {
          const requestNumber = await generateSequenceNumber(ops.sequencePrefix, () => ops.countBackorders(tx));
          nextBackorder = await ops.createBackorder(tx, order, remaining, requestNumber);
        }
        return [nextOrder, nextNotice, nextBackorder];
      });

      res.json({ order: updatedOrder, notice: updatedNotice, backorder });
    } catch (error) {
      handleError(error, res, "Respond to out-of-stock notice");
    }
  }

  // ===========================================================================
  // MODULE — Service & Workshop
  // -----------------------------------------------------------------------------
  // Intake only asks for the vehicle number, customer name and the issue —
  // nothing about parts. Parts are added one at a time, only once servicing
  // is actually under way (IN_PROGRESS/AWAITING_PARTS), and each addition
  // decrements the dealer's own spare-parts stock (DealerSparePart) in the
  // same transaction — never fabricated, never entered up front.
  // ===========================================================================

  // GET /api/v1/dealer-portal/service-tickets
  async listServiceTickets(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const tickets = await prisma.serviceTicket.findMany({
        where: { dealerId },
        include: { partsUsed: true, bill: { select: { id: true, billNumber: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json({ tickets });
    } catch (error) {
      handleError(error, res, "List dealer service tickets");
    }
  }

  // GET /api/v1/dealer-portal/service-tickets/:id
  async getServiceTicket(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const ticket = await prisma.serviceTicket.findFirst({
        where: { id, dealerId },
        include: { partsUsed: { orderBy: { usedAt: "asc" } }, bill: { select: { id: true, billNumber: true } } },
      });
      if (!ticket) return handleNotFoundError(res, "Service ticket", "Get service ticket");
      res.json(ticket);
    } catch (error) {
      handleError(error, res, "Get service ticket");
    }
  }

  // POST /api/v1/dealer-portal/service-tickets — vehicle in, at intake: just
  // the vehicle number, customer name, and the issue. Nothing about parts yet.
  async createServiceTicket(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.customerName || !b.chassisNumber || !b.issue) {
        return handleValidationError(res, "customerName, chassisNumber (vehicle number) and issue are required", "body", "Log service ticket");
      }
      const ticketNumber = await generateSequenceNumber("SVC", () => prisma.serviceTicket.count());
      const ticket = await prisma.serviceTicket.create({
        data: {
          ticketNumber,
          dealerId,
          customerName: b.customerName,
          customerPhone: b.customerPhone ?? null,
          vehicleModel: b.vehicleModel ?? null,
          chassisNumber: b.chassisNumber,
          issue: b.issue,
          priority: b.priority ?? "NORMAL",
        },
      });
      res.status(201).json(ticket);
    } catch (error) {
      handleError(error, res, "Log service ticket");
    }
  }

  // PATCH /api/v1/dealer-portal/service-tickets/:id — move the ticket through
  // its workflow: OPEN (vehicle just checked in) -> IN_PROGRESS (customer has
  // left, mechanic working) -> RESOLVED -> CLOSED, or AWAITING_PARTS if stock
  // runs out mid-job.
  async updateServiceTicketStatus(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const status = req.body?.status;
      if (!["OPEN", "IN_PROGRESS", "AWAITING_PARTS", "RESOLVED", "CLOSED"].includes(status)) {
        return handleValidationError(res, "Invalid status", "status", "Update service ticket");
      }
      const ticket = await prisma.serviceTicket.findFirst({ where: { id, dealerId } });
      if (!ticket) return handleNotFoundError(res, "Service ticket", "Update service ticket");

      const data: any = { status };
      if (status === "RESOLVED" && !ticket.resolvedAt) data.resolvedAt = new Date();
      const updated = await prisma.serviceTicket.update({ where: { id }, data });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Update service ticket");
    }
  }

  // POST /api/v1/dealer-portal/service-tickets/:id/parts — add one spare part
  // actually used, the moment the mechanic uses it. Decrements the dealer's
  // own stock in the same transaction; refuses if there isn't enough on hand.
  async addServiceTicketPart(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const ticketId = parseInt(req.params.id as string);
      const b = req.body ?? {};
      const quantityUsed = parseInt(b.quantityUsed ?? "1");
      if (!b.dealerSparePartId || !quantityUsed || quantityUsed < 1) {
        return handleValidationError(res, "dealerSparePartId and a positive quantityUsed are required", "body", "Add part used");
      }

      const ticket = await prisma.serviceTicket.findFirst({ where: { id: ticketId, dealerId } });
      if (!ticket) return handleNotFoundError(res, "Service ticket", "Add part used");
      if (!["IN_PROGRESS", "AWAITING_PARTS"].includes(ticket.status)) {
        return handleValidationError(res, "Parts can only be added once servicing is in progress", "status", "Add part used");
      }

      const part = await prisma.dealerSparePart.findFirst({ where: { id: parseInt(b.dealerSparePartId), dealerId } });
      if (!part) return handleNotFoundError(res, "Spare part", "Add part used");
      if (part.quantityOnHand < quantityUsed) {
        return handleValidationError(res, `Only ${part.quantityOnHand} ${part.partName} in stock`, "quantityUsed", "Add part used");
      }

      const usage = await prisma.$transaction(async (tx) => {
        await tx.dealerSparePart.update({ where: { id: part.id }, data: { quantityOnHand: { decrement: quantityUsed } } });
        return tx.serviceTicketPart.create({
          data: {
            serviceTicketId: ticket.id,
            dealerSparePartId: part.id,
            partName: part.partName,
            quantityUsed,
            unitPrice: part.unitPrice,
          },
        });
      });
      res.status(201).json(usage);
    } catch (error) {
      handleError(error, res, "Add part used");
    }
  }

  // DELETE /api/v1/dealer-portal/service-tickets/:id/parts/:usageId — undo a
  // mis-added part, restocking the quantity back to the dealer's inventory.
  async removeServiceTicketPart(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const ticketId = parseInt(req.params.id as string);
      const usageId = parseInt(req.params.usageId as string);

      const usage = await prisma.serviceTicketPart.findFirst({
        where: { id: usageId, serviceTicketId: ticketId, serviceTicket: { dealerId } },
      });
      if (!usage) return handleNotFoundError(res, "Part usage", "Remove part used");

      await prisma.$transaction(async (tx) => {
        await tx.dealerSparePart.update({ where: { id: usage.dealerSparePartId }, data: { quantityOnHand: { increment: usage.quantityUsed } } });
        await tx.serviceTicketPart.delete({ where: { id: usage.id } });
      });
      res.status(204).send();
    } catch (error) {
      handleError(error, res, "Remove part used");
    }
  }

  // ===========================================================================
  // SUBMODULE — Dealer's spare-parts stock (Inventory)
  // ===========================================================================

  // GET /api/v1/dealer-portal/spare-parts-stock
  async listDealerSpareParts(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const parts = await prisma.dealerSparePart.findMany({ where: { dealerId }, orderBy: { partName: "asc" } });
      res.json({ parts });
    } catch (error) {
      handleError(error, res, "List spare parts stock");
    }
  }

  // POST /api/v1/dealer-portal/spare-parts-stock — add a new part, or top up
  // an existing one's quantity (matched by name, same convention as the
  // catalog's own model matching).
  async upsertDealerSparePart(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      const quantity = parseInt(b.quantity ?? "0");
      if (!b.partName || quantity < 1) {
        return handleValidationError(res, "partName and a positive quantity are required", "body", "Add spare parts stock");
      }
      const unitPrice = b.unitPrice != null ? String(Number(b.unitPrice)) : undefined;

      const existing = await prisma.dealerSparePart.findFirst({ where: { dealerId, partName: b.partName } });
      const part = existing
        ? await prisma.dealerSparePart.update({
            where: { id: existing.id },
            data: { quantityOnHand: { increment: quantity }, ...(unitPrice != null ? { unitPrice } : {}), ...(b.partCode ? { partCode: b.partCode } : {}) },
          })
        : await prisma.dealerSparePart.create({
            data: { dealerId, partName: b.partName, partCode: b.partCode ?? null, quantityOnHand: quantity, unitPrice: unitPrice ?? "0" },
          });
      res.status(existing ? 200 : 201).json(part);
    } catch (error) {
      handleError(error, res, "Add spare parts stock");
    }
  }

  // PATCH /api/v1/dealer-portal/spare-parts-stock/:id — correct price or stock directly
  async updateDealerSparePart(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const part = await prisma.dealerSparePart.findFirst({ where: { id, dealerId } });
      if (!part) return handleNotFoundError(res, "Spare part", "Update spare parts stock");
      const b = req.body ?? {};
      const data: any = {};
      if (b.partCode !== undefined) data.partCode = b.partCode;
      if (b.unitPrice !== undefined) data.unitPrice = String(Number(b.unitPrice));
      if (b.quantityOnHand !== undefined) data.quantityOnHand = parseInt(b.quantityOnHand);
      const updated = await prisma.dealerSparePart.update({ where: { id }, data });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Update spare parts stock");
    }
  }

  // GET /api/v1/dealer-portal/warranty-claims
  async listWarrantyClaims(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const claims = await prisma.warrantyClaim.findMany({
        where: { dealerId },
        include: { componentUnit: { select: { serialNumber: true, componentType: true } }, vehicleUnit: { select: { vin: true, model: true } } },
        orderBy: { submittedAt: "desc" },
        take: 100,
      });
      res.json({ claims });
    } catch (error) {
      handleError(error, res, "List dealer warranty claims");
    }
  }

  // GET /api/v1/dealer-portal/warranty-coverage/:identifier — check a VIN/serial
  // before raising a claim, same lookup the CRM's own Coverage Check uses.
  async checkWarrantyCoverage(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const identifier = String(req.params.identifier ?? "").trim();
      if (!identifier) return handleValidationError(res, "identifier is required", "identifier", "Coverage check");

      const vehicleUnit = await prisma.vehicleUnit.findUnique({
        where: { vin: identifier },
        include: { componentUnits: { include: { plan: true } } },
      });
      if (!vehicleUnit || vehicleUnit.dealerId !== dealerId) {
        return handleNotFoundError(res, "Vehicle", "Coverage check");
      }

      const now = Date.now();
      const components = vehicleUnit.componentUnits.map((c) => {
        const plan = c.plan;
        let inWarranty: boolean | null = null;
        let expiresAt: Date | null = null;
        if (plan && c.registeredAt) {
          expiresAt = new Date(c.registeredAt);
          expiresAt.setMonth(expiresAt.getMonth() + plan.termMonths);
          inWarranty = now <= expiresAt.getTime();
        }
        return {
          id: c.id,
          serialNumber: c.serialNumber,
          componentType: c.componentType,
          inWarranty,
          expiresAt,
        };
      });

      res.json({ vehicle: { id: vehicleUnit.id, vin: vehicleUnit.vin, model: vehicleUnit.model }, components });
    } catch (error) {
      handleError(error, res, "Coverage check");
    }
  }

  // POST /api/v1/dealer-portal/warranty-claims — dealer raises a warranty claim.
  // Runs through the exact same adjudication engine the CRM's Claims & Coverage
  // tab uses, so it lands there already triaged, not as a blank intake row.
  async createWarrantyClaim(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.customerName || !b.issueDescription) {
        return handleValidationError(res, "customerName and issueDescription are required", "body", "Raise warranty claim");
      }

      if (b.componentUnitId) {
        const owned = await prisma.componentUnit.findFirst({
          where: { id: parseInt(b.componentUnitId), vehicleUnit: { dealerId } },
        });
        if (!owned) return handleValidationError(res, "That component isn't on a vehicle allocated to your dealership", "componentUnitId", "Raise warranty claim");
      }

      const { claim, adjudication } = await submitWarrantyClaim({
        dealerId,
        vehicleUnitId: b.vehicleUnitId ? parseInt(b.vehicleUnitId) : null,
        componentUnitId: b.componentUnitId ? parseInt(b.componentUnitId) : null,
        chassisNumber: b.chassisNumber ?? null,
        customerName: b.customerName,
        customerPhone: b.customerPhone ?? null,
        issueDescription: b.issueDescription,
        odometerReading: b.odometerReading ?? null,
        measuredSohPct: b.measuredSohPct ?? null,
        chargerType: b.chargerType ?? null,
        serviceRecordsComplete: b.serviceRecordsComplete !== false,
        claimAmount: b.claimAmount ?? null,
      });

      res.status(201).json({ ...claim, adjudication });
    } catch (error) {
      handleError(error, res, "Raise warranty claim");
    }
  }

  // -------------------------------------------------------------------------
  // Leads & Enquiry (DMS Module D3) — a Lead has no dealerId of its own;
  // "assigned to this dealer" is the DealerLeadAssignment join row. Scoping
  // every query through that join is what keeps one dealer from ever seeing
  // another's leads, same as SALES-role scoping does for staff in
  // leads.controller.ts.
  // -------------------------------------------------------------------------

  // GET /api/v1/dealer-portal/leads  (?status=&search=)
  async listLeads(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const { status, search } = req.query;
      const assignmentWhere: any = { dealerId };
      if (status && status !== "ALL") assignmentWhere.status = status;
      if (search) {
        assignmentWhere.lead = {
          OR: [
            { firstName: { contains: search as string } },
            { lastName: { contains: search as string } },
            { email: { contains: search as string } },
            { phone: { contains: search as string } },
          ],
        };
      }

      const assignments = await prisma.dealerLeadAssignment.findMany({
        where: assignmentWhere,
        include: {
          lead: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, source: true, status: true, score: true, createdAt: true } },
        },
        orderBy: { assignedAt: "desc" },
        take: 200,
      });
      res.json({ leads: assignments.map((a) => ({ ...a.lead, assignment: { id: a.id, status: a.status, assignedAt: a.assignedAt, outcome: a.outcome } })) });
    } catch (error) {
      handleError(error, res, "List dealer leads");
    }
  }

  // GET /api/v1/dealer-portal/leads/:id
  async getLead(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const leadId = parseInt(req.params.id as string);
      const assignment = await prisma.dealerLeadAssignment.findFirst({
        where: { leadId, dealerId },
        include: {
          lead: {
            include: {
              remarks: { orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, firstName: true, lastName: true } } } },
            },
          },
        },
      });
      if (!assignment) return handleNotFoundError(res, "Lead", "Get dealer lead");
      res.json({ ...assignment.lead, assignment: { id: assignment.id, status: assignment.status, assignedAt: assignment.assignedAt, outcome: assignment.outcome } });
    } catch (error) {
      handleError(error, res, "Get dealer lead");
    }
  }

  // POST /api/v1/dealer-portal/leads — walk-in enquiry logged directly by the dealer
  async createLead(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.firstName || !b.email) {
        return handleValidationError(res, "firstName and email are required", "body", "Log walk-in lead");
      }

      const { lead } = await prisma.$transaction(async (tx) => {
        const created = await tx.lead.create({
          data: {
            firstName: b.firstName,
            lastName: b.lastName ?? null,
            email: b.email,
            phone: b.phone ?? null,
            city: b.city ?? null,
            state: b.state ?? null,
            source: "MANUAL",
            status: "OPEN",
          },
        });
        await tx.dealerLeadAssignment.create({
          data: { leadId: created.id, dealerId, status: "ACCEPTED", routedBy: "MANUAL", respondedAt: new Date() },
        });
        return { lead: created };
      });

      res.status(201).json(lead);
    } catch (error) {
      handleError(error, res, "Log walk-in lead");
    }
  }

  // PATCH /api/v1/dealer-portal/leads/:id — body: { status?, outcome? }
  // status here is the DealerLeadAssignment's own routing status (follow-up
  // progress), not the network-wide Lead.status a staff manager controls —
  // a dealer can mark their own assignment CONTACTED/CONVERTED/LOST with a
  // reason, per the SRS's "close with reason, never delete."
  async updateLeadAssignment(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const leadId = parseInt(req.params.id as string);
      const b = req.body ?? {};

      const assignment = await prisma.dealerLeadAssignment.findFirst({ where: { leadId, dealerId } });
      if (!assignment) return handleNotFoundError(res, "Lead", "Update dealer lead");

      const data: any = {};
      if (b.status !== undefined) {
        data.status = b.status;
        if (!assignment.respondedAt) data.respondedAt = new Date();
      }
      if (b.outcome !== undefined) data.outcome = b.outcome;

      const updated = await prisma.$transaction(async (tx) => {
        const next = await tx.dealerLeadAssignment.update({ where: { id: assignment.id }, data });
        if (b.status === "CONVERTED") await tx.lead.update({ where: { id: leadId }, data: { status: "CONVERTED" } });
        return next;
      });

      res.json(updated);
    } catch (error) {
      handleError(error, res, "Update dealer lead");
    }
  }

  // POST /api/v1/dealer-portal/leads/:id/remarks — body: { remark }
  async addLeadRemark(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const leadId = parseInt(req.params.id as string);
      const remarkText = (req.body?.remark ?? "").toString().trim();
      if (!remarkText) return handleValidationError(res, "remark is required", "remark", "Add lead remark");

      const assignment = await prisma.dealerLeadAssignment.findFirst({ where: { leadId, dealerId } });
      if (!assignment) return handleNotFoundError(res, "Lead", "Add lead remark");

      const remark = await prisma.leadRemark.create({ data: { leadId, dealerId, remark: remarkText } });
      res.status(201).json(remark);
    } catch (error) {
      handleError(error, res, "Add lead remark");
    }
  }

  // -------------------------------------------------------------------------
  // Campaign Management — same feature set as the staff side
  // (campaignManagement.controller.ts: Segments + Email/WhatsApp Campaigns),
  // ported as asked. The safety boundary isn't in the UI, it's in
  // segmentWhere(): every dealer-owned segment's membership query is always
  // additionally intersected with that dealer's own DealerLeadAssignment
  // leads, so a dealer can build/send against their own pool only, never the
  // network's — same principle as every other dealer-portal endpoint here.
  // -------------------------------------------------------------------------

  // GET /api/v1/dealer-portal/segments
  async listSegments(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const segments = await prisma.segment.findMany({ where: { dealerId }, orderBy: { createdAt: "desc" } });
      const withCounts = await Promise.all(
        segments.map(async (s) => ({ ...s, memberCount: await prisma.lead.count({ where: segmentWhere(s) }) }))
      );
      res.json({ segments: withCounts });
    } catch (error) {
      handleError(error, res, "List dealer segments");
    }
  }

  // POST /api/v1/dealer-portal/segments
  async createSegment(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.name) return handleValidationError(res, "name is required", "name", "Create segment");
      const segment = await prisma.segment.create({
        data: {
          name: b.name,
          description: b.description ?? null,
          statusFilter: b.statusFilter || null,
          sourceFilter: b.sourceFilter || null,
          stateFilter: b.stateFilter || null,
          dealerId,
        },
      });
      const memberCount = await prisma.lead.count({ where: segmentWhere(segment) });
      res.status(201).json({ ...segment, memberCount });
    } catch (error) {
      handleError(error, res, "Create dealer segment");
    }
  }

  // DELETE /api/v1/dealer-portal/segments/:id
  async deleteSegment(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const segment = await prisma.segment.findFirst({ where: { id, dealerId } });
      if (!segment) return handleNotFoundError(res, "Segment", "Delete dealer segment");
      await prisma.segment.delete({ where: { id } });
      res.status(204).send();
    } catch (error) {
      handleError(error, res, "Delete dealer segment");
    }
  }

  // GET /api/v1/dealer-portal/campaigns  (?channel=EMAIL|WHATSAPP&status=)
  async listCampaigns(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const { channel, status } = req.query;
      const where: any = { dealerId };
      if (channel) where.channel = channel;
      if (status) where.status = status;
      const campaigns = await prisma.marketingCampaign.findMany({
        where,
        include: { segment: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      });
      res.json({ campaigns });
    } catch (error) {
      handleError(error, res, "List dealer campaigns");
    }
  }

  // POST /api/v1/dealer-portal/campaigns
  async createCampaign(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.name || !b.channel || !b.message) {
        return handleValidationError(res, "name, channel and message are required", "body", "Create campaign");
      }
      if (b.segmentId) {
        const owned = await prisma.segment.findFirst({ where: { id: parseInt(b.segmentId), dealerId } });
        if (!owned) return handleValidationError(res, "That segment isn't one of yours", "segmentId", "Create campaign");
      }
      const campaign = await prisma.marketingCampaign.create({
        data: {
          name: b.name,
          channel: b.channel,
          subject: b.channel === "EMAIL" ? (b.subject ?? null) : null,
          message: b.message,
          segmentId: b.segmentId ? parseInt(b.segmentId) : null,
          scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null,
          dealerId,
        },
      });
      res.status(201).json(campaign);
    } catch (error) {
      handleError(error, res, "Create dealer campaign");
    }
  }

  // PATCH /api/v1/dealer-portal/campaigns/:id — body: { status }
  async updateCampaign(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const status = req.body?.status;
      if (!status) return handleValidationError(res, "status is required", "status", "Update campaign");

      const campaign = await prisma.marketingCampaign.findFirst({ where: { id, dealerId }, include: { segment: true } });
      if (!campaign) return handleNotFoundError(res, "Campaign", "Update campaign");

      const data: any = { status };
      if (status === "SENT") {
        data.sentAt = new Date();
        data.audienceCount = campaign.segment ? await prisma.lead.count({ where: segmentWhere(campaign.segment) }) : 0;
      }
      const updated = await prisma.marketingCampaign.update({ where: { id }, data });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Update dealer campaign");
    }
  }

  // ===========================================================================
  // MODULE — Sales & Booking
  // -----------------------------------------------------------------------------
  // BOOKED -> (CONFIRMED) -> ALLOCATED (a real VehicleUnit from this dealer's
  // own stock is earmarked) -> DELIVERED, which is the exact OPEN->SOLD
  // transition dealerInventory.controller.ts#update performs for staff: soldAt
  // stamp, buyerName, and registerComponentsForSale for warranty. A DMS-side
  // delivery is therefore indistinguishable from a staff-recorded sale to
  // every other module (Warranty, Overview's sales trend/top-models charts).
  // ===========================================================================

  // GET /api/v1/dealer-portal/bookings
  async listBookings(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const bookings = await prisma.booking.findMany({
        where: { dealerId },
        include: {
          vehicleUnit: { select: { id: true, vin: true, model: true, status: true } },
          lead: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      res.json({ bookings });
    } catch (error) {
      handleError(error, res, "List bookings");
    }
  }

  // GET /api/v1/dealer-portal/bookings/available-units?model=
  // Units from this dealer's own allocated stock that are sellable (not sold,
  // not damaged) and not already earmarked against another booking.
  async listAvailableUnitsForBooking(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const { model } = req.query as Record<string, string | undefined>;
      const where: any = { dealerId, status: { in: ["IN_STOCK", "ALLOCATED", "DEMO"] }, booking: null };
      if (model) where.model = model;
      const units = await prisma.vehicleUnit.findMany({
        where,
        select: { id: true, vin: true, model: true, segment: true, color: true, status: true },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      res.json({ units });
    } catch (error) {
      handleError(error, res, "List available units for booking");
    }
  }

  // POST /api/v1/dealer-portal/bookings — customer places a token/advance to reserve a vehicle
  async createBooking(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.customerName || !b.customerPhone || !b.model || !b.segment || b.bookingAmount == null) {
        return handleValidationError(res, "customerName, customerPhone, model, segment and bookingAmount are required", "body", "Create booking");
      }
      const bookingNumber = await generateSequenceNumber("BKG", () => prisma.booking.count());
      const booking = await prisma.booking.create({
        data: {
          dealerId,
          bookingNumber,
          customerName: b.customerName,
          customerPhone: b.customerPhone,
          customerEmail: b.customerEmail ?? null,
          customerAddress: b.customerAddress ?? null,
          model: b.model,
          segment: b.segment,
          color: b.color ?? null,
          bookingAmount: String(b.bookingAmount),
          paymentMode: b.paymentMode ?? "CASH",
          expectedDeliveryDate: b.expectedDeliveryDate ? new Date(b.expectedDeliveryDate) : null,
          leadId: b.leadId ? parseInt(b.leadId) : null,
          notes: b.notes ?? null,
        },
      });
      res.status(201).json(booking);
    } catch (error) {
      handleError(error, res, "Create booking");
    }
  }

  // PATCH /api/v1/dealer-portal/bookings/:id — drive the booking through its lifecycle
  async updateBooking(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const b = req.body ?? {};
      const status = b.status;

      const booking = await prisma.booking.findFirst({ where: { id, dealerId } });
      if (!booking) return handleNotFoundError(res, "Booking", "Update booking");
      if (booking.status === "DELIVERED" || booking.status === "CANCELLED") {
        return handleValidationError(res, `Booking is already ${booking.status.toLowerCase()} and can no longer be changed`, "status", "Update booking");
      }

      if (status === "CONFIRMED") {
        const updated = await prisma.booking.update({ where: { id }, data: { status: "CONFIRMED" } });
        return res.json(updated);
      }

      if (status === "ALLOCATED") {
        if (!b.vehicleUnitId) return handleValidationError(res, "vehicleUnitId is required to allocate a unit", "vehicleUnitId", "Update booking");
        const unit = await prisma.vehicleUnit.findFirst({
          where: { id: parseInt(b.vehicleUnitId), dealerId, status: { in: ["IN_STOCK", "ALLOCATED", "DEMO"] }, booking: null },
        });
        if (!unit) return handleValidationError(res, "That unit isn't available in your stock", "vehicleUnitId", "Update booking");
        const updated = await prisma.booking.update({ where: { id }, data: { status: "ALLOCATED", vehicleUnitId: unit.id } });
        return res.json(updated);
      }

      if (status === "DELIVERED") {
        if (!booking.vehicleUnitId) return handleValidationError(res, "Allocate a specific vehicle unit before marking delivered", "status", "Update booking");
        const updated = await prisma.$transaction(async (tx) => {
          const unit = await tx.vehicleUnit.update({
            where: { id: booking.vehicleUnitId! },
            data: { status: "SOLD", soldAt: new Date(), buyerName: booking.customerName },
          });
          await registerComponentsForSale(tx, unit);
          return tx.booking.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
        }, { timeout: 15000 });
        return res.json(updated);
      }

      if (status === "CANCELLED") {
        const updated = await prisma.booking.update({
          where: { id },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: b.cancellationReason ?? null, vehicleUnitId: null },
        });
        return res.json(updated);
      }

      return handleValidationError(res, "status must be CONFIRMED, ALLOCATED, DELIVERED or CANCELLED", "status", "Update booking");
    } catch (error) {
      handleError(error, res, "Update booking");
    }
  }

  // ===========================================================================
  // MODULE — Billing
  // -----------------------------------------------------------------------------
  // The customer-facing sale bill. Distinct from `Invoice` (the OEM->dealer
  // stock-order confirmation used elsewhere in this file) — this is what the
  // dealer hands the customer. Generating one from a DELIVERED booking pulls
  // every fact that's already on record (customer, model, VIN); the dealer
  // only supplies the commercial numbers only they know.
  // ===========================================================================

  // GET /api/v1/dealer-portal/billable-bookings — DELIVERED bookings with no bill yet
  async listBillableBookings(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const bookings = await prisma.booking.findMany({
        where: { dealerId, status: "DELIVERED", bill: null },
        include: { vehicleUnit: { select: { id: true, vin: true, model: true } } },
        orderBy: { deliveredAt: "desc" },
      });
      res.json({ bookings });
    } catch (error) {
      handleError(error, res, "List billable bookings");
    }
  }

  // GET /api/v1/dealer-portal/billable-service-tickets — RESOLVED/CLOSED tickets with no bill yet
  async listBillableServiceTickets(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const tickets = await prisma.serviceTicket.findMany({
        where: { dealerId, status: { in: ["RESOLVED", "CLOSED"] }, bill: null },
        include: { partsUsed: true },
        orderBy: { resolvedAt: "desc" },
      });
      res.json({
        tickets: tickets.map((t) => ({
          ...t,
          partsAmount: t.partsUsed.reduce((sum, p) => sum + Number(p.unitPrice) * p.quantityUsed, 0),
        })),
      });
    } catch (error) {
      handleError(error, res, "List billable service tickets");
    }
  }

  // GET /api/v1/dealer-portal/bills
  async listBills(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const bills = await prisma.customerBill.findMany({
        where: { dealerId },
        include: {
          booking: { select: { id: true, bookingNumber: true } },
          serviceTicket: { select: { id: true, ticketNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      res.json({ bills });
    } catch (error) {
      handleError(error, res, "List bills");
    }
  }

  // POST /api/v1/dealer-portal/bills — from a delivered booking (preferred, pulls
  // customer + vehicle facts off the real record) or fully manual for a sale
  // made outside the booking flow.
  async createBill(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};

      let customerName = b.customerName;
      let customerPhone = b.customerPhone;
      let model = b.model;
      let vin: string | null = b.vin ?? null;
      let vehicleUnitId: number | null = null;
      let bookingId: number | null = null;
      let serviceTicketId: number | null = null;
      let billType: "VEHICLE_SALE" | "SERVICE" = "VEHICLE_SALE";
      let partsAmount = 0;

      if (b.bookingId) {
        const booking = await prisma.booking.findFirst({
          where: { id: parseInt(b.bookingId), dealerId, status: "DELIVERED" },
          include: { vehicleUnit: { select: { id: true, vin: true } }, bill: true },
        });
        if (!booking) return handleValidationError(res, "That booking isn't a delivered booking on your account", "bookingId", "Create bill");
        if (booking.bill) return handleValidationError(res, "This booking already has a bill", "bookingId", "Create bill");
        customerName = booking.customerName;
        customerPhone = booking.customerPhone;
        model = booking.model;
        vin = booking.vehicleUnit?.vin ?? null;
        vehicleUnitId = booking.vehicleUnit?.id ?? null;
        bookingId = booking.id;
      } else if (b.serviceTicketId) {
        const ticket = await prisma.serviceTicket.findFirst({
          where: { id: parseInt(b.serviceTicketId), dealerId, status: { in: ["RESOLVED", "CLOSED"] } },
          include: { partsUsed: true, bill: true },
        });
        if (!ticket) return handleValidationError(res, "That isn't a resolved service ticket on your account", "serviceTicketId", "Create bill");
        if (ticket.bill) return handleValidationError(res, "This service ticket already has a bill", "serviceTicketId", "Create bill");
        if (b.laborCharge == null) return handleValidationError(res, "laborCharge is required to bill a service ticket", "laborCharge", "Create bill");
        customerName = ticket.customerName;
        customerPhone = ticket.customerPhone ?? "—";
        model = ticket.vehicleModel ?? "—";
        vin = ticket.chassisNumber;
        serviceTicketId = ticket.id;
        billType = "SERVICE";
        // partsAmount is always the real sum of what was actually used — never hand-typed.
        partsAmount = ticket.partsUsed.reduce((sum, p) => sum + Number(p.unitPrice) * p.quantityUsed, 0);
      }

      if (billType === "VEHICLE_SALE" && b.exShowroomPrice == null) {
        return handleValidationError(res, "exShowroomPrice is required", "exShowroomPrice", "Create bill");
      }
      if (!customerName || !customerPhone || !model) {
        return handleValidationError(res, "customerName, customerPhone and model are required (or pass a bookingId/serviceTicketId)", "body", "Create bill");
      }

      const exShowroomPrice = billType === "VEHICLE_SALE" ? Number(b.exShowroomPrice) : 0;
      const accessoriesAmount = billType === "VEHICLE_SALE" ? Number(b.accessoriesAmount ?? 0) : 0;
      const registrationAmount = billType === "VEHICLE_SALE" ? Number(b.registrationAmount ?? 0) : 0;
      const insuranceAmount = billType === "VEHICLE_SALE" ? Number(b.insuranceAmount ?? 0) : 0;
      const laborCharge = billType === "SERVICE" ? Number(b.laborCharge) : 0;
      const discountAmount = Number(b.discountAmount ?? 0);
      const gstRate = Number(b.gstRate ?? 5);
      const taxableAmount = exShowroomPrice + accessoriesAmount + registrationAmount + insuranceAmount + laborCharge + partsAmount - discountAmount;
      const gstAmount = Math.round(taxableAmount * (gstRate / 100) * 100) / 100;
      const totalAmount = Math.round((taxableAmount + gstAmount) * 100) / 100;

      // GST split: intra-state sales (customer's billing state == dealer's
      // registered state) split the tax as CGST+SGST (half each); any other
      // state is inter-state and the whole amount is IGST — the same rule
      // the GST portal itself applies based on place of supply.
      const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, select: { state: true } });
      const customerState: string | null = b.customerState ?? null;
      const isInterState = !!(customerState && dealer?.state && customerState.trim().toLowerCase() !== dealer.state.trim().toLowerCase());
      const cgstAmount = isInterState ? 0 : Math.round((gstAmount / 2) * 100) / 100;
      const sgstAmount = isInterState ? 0 : gstAmount - cgstAmount;
      const igstAmount = isInterState ? gstAmount : 0;

      const billNumber = await generateSequenceNumber("BILL", () => prisma.customerBill.count());
      const bill = await prisma.customerBill.create({
        data: {
          dealerId,
          billNumber,
          billType,
          bookingId,
          serviceTicketId,
          vehicleUnitId,
          customerName,
          customerPhone,
          customerAddress: b.customerAddress ?? null,
          customerState,
          customerGstin: b.customerGstin ?? null,
          model,
          vin,
          hsnCode: b.hsnCode || "8703",
          placeOfSupply: customerState ?? dealer?.state ?? null,
          isInterState,
          cgstAmount: String(cgstAmount),
          sgstAmount: String(sgstAmount),
          igstAmount: String(igstAmount),
          exShowroomPrice: String(exShowroomPrice),
          accessoriesAmount: String(accessoriesAmount),
          registrationAmount: String(registrationAmount),
          insuranceAmount: String(insuranceAmount),
          laborCharge: String(laborCharge),
          partsAmount: String(partsAmount),
          discountAmount: String(discountAmount),
          taxableAmount: String(taxableAmount),
          gstRate: String(gstRate),
          gstAmount: String(gstAmount),
          totalAmount: String(totalAmount),
          paymentMode: b.paymentMode ?? "CASH",
          notes: b.notes ?? null,
        },
      });
      res.status(201).json(bill);
    } catch (error) {
      handleError(error, res, "Create bill");
    }
  }

  // GET /api/v1/dealer-portal/bills/:id/gst-invoice — full GST-compliant invoice view
  async getGstInvoice(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const bill = await prisma.customerBill.findFirst({
        where: { id, dealerId },
        include: { dealer: { select: { legalName: true, tradeName: true, gstNumber: true, addressLine: true, city: true, state: true, pincode: true } }, ewayBill: true },
      });
      if (!bill) return handleNotFoundError(res, "Bill", "Get GST invoice");
      res.json({ invoice: bill });
    } catch (error) {
      handleError(error, res, "Get GST invoice");
    }
  }

  // PATCH /api/v1/dealer-portal/bills/:id/payment — record a payment against the bill
  async recordBillPayment(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const amount = Number(req.body?.amount);
      if (!amount || amount <= 0) return handleValidationError(res, "amount must be a positive number", "amount", "Record bill payment");

      const bill = await prisma.customerBill.findFirst({ where: { id, dealerId } });
      if (!bill) return handleNotFoundError(res, "Bill", "Record bill payment");
      if (bill.status === "CANCELLED") return handleValidationError(res, "This bill is cancelled", "status", "Record bill payment");
      if (bill.status === "PAID") return handleValidationError(res, "This bill is already fully paid", "status", "Record bill payment");

      const amountPaid = Number(bill.amountPaid) + amount;
      const total = Number(bill.totalAmount);
      const status = amountPaid >= total ? "PAID" : "PARTIALLY_PAID";
      const updated = await prisma.customerBill.update({
        where: { id },
        data: { amountPaid: String(Math.min(amountPaid, total)), status, paidAt: status === "PAID" ? new Date() : null },
      });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Record bill payment");
    }
  }

  // PATCH /api/v1/dealer-portal/bills/:id — cancel an unpaid/partially-paid bill
  async cancelBill(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const bill = await prisma.customerBill.findFirst({ where: { id, dealerId } });
      if (!bill) return handleNotFoundError(res, "Bill", "Cancel bill");
      if (bill.status === "PAID") return handleValidationError(res, "A fully paid bill can't be cancelled", "status", "Cancel bill");
      const updated = await prisma.customerBill.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Cancel bill");
    }
  }

  // ===========================================================================
  // SUBMODULE — E-way bill generation
  // -----------------------------------------------------------------------------
  // GST rule enforced here, not left to the dealer's judgement: e-way bills
  // are only generatable for consignments whose taxable value exceeds the
  // real statutory threshold (₹50,000). Validity follows the same 1-day-per-
  // 200km rule (minimum 1 day) the GST portal itself computes.
  // ===========================================================================

  // POST /api/v1/dealer-portal/bills/:id/eway-bill
  async generateEwayBill(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const b = req.body ?? {};
      if (!b.transporterName || !b.vehicleNumber || !b.distanceKm) {
        return handleValidationError(res, "transporterName, vehicleNumber and distanceKm are required", "body", "Generate e-way bill");
      }

      const bill = await prisma.customerBill.findFirst({ where: { id, dealerId }, include: { ewayBill: true } });
      if (!bill) return handleNotFoundError(res, "Bill", "Generate e-way bill");
      if (bill.status === "CANCELLED") return handleValidationError(res, "This bill is cancelled", "status", "Generate e-way bill");
      if (bill.ewayBill) return handleValidationError(res, "This bill already has an e-way bill", "billId", "Generate e-way bill");
      if (Number(bill.taxableAmount) <= EWAY_BILL_THRESHOLD) {
        return handleValidationError(
          res,
          `E-way bills are only required for consignments over ₹${EWAY_BILL_THRESHOLD.toLocaleString("en-IN")} taxable value — this bill is ₹${Number(bill.taxableAmount).toLocaleString("en-IN")}`,
          "taxableAmount",
          "Generate e-way bill"
        );
      }

      const distanceKm = parseInt(b.distanceKm);
      const validDays = Math.max(1, Math.ceil(distanceKm / 200));
      const generatedAt = new Date();
      const validUntil = new Date(generatedAt.getTime() + validDays * 86_400_000);

      const ewayBillNumber = await generateSequenceNumber("EWB", () => prisma.ewayBill.count());
      const ewayBill = await prisma.ewayBill.create({
        data: {
          dealerId,
          billId: bill.id,
          ewayBillNumber,
          transporterName: b.transporterName,
          transporterGstin: b.transporterGstin ?? null,
          vehicleNumber: b.vehicleNumber,
          transportMode: b.transportMode ?? "ROAD",
          distanceKm,
          generatedAt,
          validUntil,
        },
      });
      res.status(201).json(ewayBill);
    } catch (error) {
      handleError(error, res, "Generate e-way bill");
    }
  }

  // PATCH /api/v1/dealer-portal/eway-bills/:id — cancel
  async cancelEwayBill(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const ewayBill = await prisma.ewayBill.findFirst({ where: { id, dealerId } });
      if (!ewayBill) return handleNotFoundError(res, "E-way bill", "Cancel e-way bill");
      if (ewayBill.status === "CANCELLED") return handleValidationError(res, "Already cancelled", "status", "Cancel e-way bill");
      const updated = await prisma.ewayBill.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: req.body?.reason ?? null },
      });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Cancel e-way bill");
    }
  }

}
