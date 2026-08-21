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

// Parses a "YYYY-MM-DD" calendar date literally as UTC midnight, independent
// of the server's local timezone. `new Date(y, m, d)` (no Date.UTC) reads its
// arguments as LOCAL time — on a server running IST (UTC+5:30) that silently
// stores the previous day's 18:30 UTC instead of the calendar date the user
// actually picked. Every attendance/leave date must go through this, not a
// bare `new Date(str)` or local-component constructor.
function parseDateOnly(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

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

  // GET /api/v1/dealer-portal/service-tickets
  async listServiceTickets(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const tickets = await prisma.serviceTicket.findMany({ where: { dealerId }, orderBy: { createdAt: "desc" }, take: 100 });
      res.json({ tickets });
    } catch (error) {
      handleError(error, res, "List dealer service tickets");
    }
  }

  // POST /api/v1/dealer-portal/service-tickets — dealer logs a customer service issue
  async createServiceTicket(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.customerName || !b.issue) {
        return handleValidationError(res, "customerName and issue are required", "body", "Log service ticket");
      }
      const ticketNumber = await generateSequenceNumber("SVC", () => prisma.serviceTicket.count());
      const ticket = await prisma.serviceTicket.create({
        data: {
          ticketNumber,
          dealerId,
          customerName: b.customerName,
          customerPhone: b.customerPhone ?? null,
          vehicleModel: b.vehicleModel ?? null,
          chassisNumber: b.chassisNumber ?? null,
          issue: b.issue,
          priority: b.priority ?? "NORMAL",
        },
      });
      res.status(201).json(ticket);
    } catch (error) {
      handleError(error, res, "Log service ticket");
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
  // MODULE — HRMS: Employee Master, Attendance & Leave, Payroll
  // ===========================================================================

  // GET /api/v1/dealer-portal/hr/employees
  async listEmployees(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const employees = await prisma.employee.findMany({
        where: { dealerId },
        include: { reportingManager: { select: { id: true, fullName: true } } },
        orderBy: { fullName: "asc" },
      });
      res.json({ employees });
    } catch (error) {
      handleError(error, res, "List employees");
    }
  }

  // POST /api/v1/dealer-portal/hr/employees
  async createEmployee(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.fullName || !b.phone || !b.department || !b.designation || !b.dateOfJoining) {
        return handleValidationError(res, "fullName, phone, department, designation and dateOfJoining are required", "body", "Create employee");
      }
      const employeeCode = await generateSequenceNumber("EMP", () => prisma.employee.count({ where: { dealerId } }));
      const employee = await prisma.employee.create({
        data: {
          dealerId,
          employeeCode: `${employeeCode}-D${dealerId}`,
          fullName: b.fullName,
          gender: b.gender ?? null,
          dob: b.dob ? new Date(b.dob) : null,
          phone: b.phone,
          email: b.email ?? null,
          department: b.department,
          designation: b.designation,
          reportingManagerId: b.reportingManagerId ? parseInt(b.reportingManagerId) : null,
          dateOfJoining: new Date(b.dateOfJoining),
          workLocation: b.workLocation ?? null,
          monthlySalary: b.monthlySalary ? String(b.monthlySalary) : null,
          notes: b.notes ?? null,
        },
      });
      res.status(201).json(employee);
    } catch (error) {
      handleError(error, res, "Create employee");
    }
  }

  // PATCH /api/v1/dealer-portal/hr/employees/:id
  async updateEmployee(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const employee = await prisma.employee.findFirst({ where: { id, dealerId } });
      if (!employee) return handleNotFoundError(res, "Employee", "Update employee");

      const b = req.body ?? {};
      const data: any = {};
      if (b.fullName !== undefined) data.fullName = b.fullName;
      if (b.gender !== undefined) data.gender = b.gender;
      if (b.dob !== undefined) data.dob = b.dob ? new Date(b.dob) : null;
      if (b.phone !== undefined) data.phone = b.phone;
      if (b.email !== undefined) data.email = b.email;
      if (b.department !== undefined) data.department = b.department;
      if (b.designation !== undefined) data.designation = b.designation;
      if (b.reportingManagerId !== undefined) data.reportingManagerId = b.reportingManagerId ? parseInt(b.reportingManagerId) : null;
      if (b.workLocation !== undefined) data.workLocation = b.workLocation;
      if (b.monthlySalary !== undefined) data.monthlySalary = b.monthlySalary ? String(b.monthlySalary) : null;
      if (b.status !== undefined) data.status = b.status;
      if (b.notes !== undefined) data.notes = b.notes;

      const updated = await prisma.employee.update({ where: { id }, data });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Update employee");
    }
  }

  // GET /api/v1/dealer-portal/hr/attendance?date=YYYY-MM-DD&month=&year=&employeeId=
  async listAttendance(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const { date, month, year, employeeId } = req.query as Record<string, string | undefined>;
      const where: any = { dealerId };
      if (employeeId) where.employeeId = parseInt(employeeId);
      if (date) {
        const d = parseDateOnly(date);
        where.date = { gte: d, lt: new Date(d.getTime() + 86_400_000) };
      } else if (month && year) {
        const m = parseInt(month) - 1;
        const y = parseInt(year);
        where.date = { gte: new Date(Date.UTC(y, m, 1)), lt: new Date(Date.UTC(y, m + 1, 1)) };
      }
      const records = await prisma.attendanceRecord.findMany({
        where,
        include: { employee: { select: { id: true, fullName: true, employeeCode: true, department: true } } },
        orderBy: [{ date: "desc" }, { employeeId: "asc" }],
        take: 500,
      });
      const leaveRequests = await prisma.leaveRequest.findMany({
        where: { dealerId },
        include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json({ records, leaveRequests });
    } catch (error) {
      handleError(error, res, "List attendance");
    }
  }

  // POST /api/v1/dealer-portal/hr/attendance — mark/update one employee's status for one date
  async markAttendance(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.employeeId || !b.date || !b.status) {
        return handleValidationError(res, "employeeId, date and status are required", "body", "Mark attendance");
      }
      const employee = await prisma.employee.findFirst({ where: { id: parseInt(b.employeeId), dealerId } });
      if (!employee) return handleNotFoundError(res, "Employee", "Mark attendance");

      const day = parseDateOnly(b.date);
      const record = await prisma.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: employee.id, date: day } },
        create: {
          employeeId: employee.id,
          dealerId,
          date: day,
          status: b.status,
          checkIn: b.checkIn ? new Date(b.checkIn) : null,
          checkOut: b.checkOut ? new Date(b.checkOut) : null,
          notes: b.notes ?? null,
        },
        update: {
          status: b.status,
          checkIn: b.checkIn ? new Date(b.checkIn) : null,
          checkOut: b.checkOut ? new Date(b.checkOut) : null,
          notes: b.notes ?? null,
        },
      });
      res.status(201).json(record);
    } catch (error) {
      handleError(error, res, "Mark attendance");
    }
  }

  // POST /api/v1/dealer-portal/hr/leave-requests
  async createLeaveRequest(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      if (!b.employeeId || !b.leaveType || !b.startDate || !b.endDate) {
        return handleValidationError(res, "employeeId, leaveType, startDate and endDate are required", "body", "Create leave request");
      }
      const employee = await prisma.employee.findFirst({ where: { id: parseInt(b.employeeId), dealerId } });
      if (!employee) return handleNotFoundError(res, "Employee", "Create leave request");

      const leave = await prisma.leaveRequest.create({
        data: {
          employeeId: employee.id,
          dealerId,
          leaveType: b.leaveType,
          startDate: parseDateOnly(b.startDate),
          endDate: parseDateOnly(b.endDate),
          reason: b.reason ?? null,
        },
      });
      res.status(201).json(leave);
    } catch (error) {
      handleError(error, res, "Create leave request");
    }
  }

  // PATCH /api/v1/dealer-portal/hr/leave-requests/:id — approve/reject; approving
  // auto-marks the employee's attendance ON_LEAVE for every day in the range so
  // payroll never has to re-derive it from two disagreeing sources.
  async decideLeaveRequest(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const status = req.body?.status;
      if (!["APPROVED", "REJECTED", "CANCELLED"].includes(status)) {
        return handleValidationError(res, "status must be APPROVED, REJECTED or CANCELLED", "status", "Decide leave request");
      }
      const leave = await prisma.leaveRequest.findFirst({ where: { id, dealerId } });
      if (!leave) return handleNotFoundError(res, "Leave request", "Decide leave request");

      const updated = await prisma.$transaction(async (tx) => {
        const next = await tx.leaveRequest.update({ where: { id }, data: { status, decidedAt: new Date() } });
        if (status === "APPROVED") {
          const days: Date[] = [];
          let cursor = leave.startDate.getTime();
          const end = leave.endDate.getTime();
          while (cursor <= end) {
            days.push(new Date(cursor));
            cursor += 86_400_000;
          }
          for (const day of days) {
            await tx.attendanceRecord.upsert({
              where: { employeeId_date: { employeeId: leave.employeeId, date: day } },
              create: { employeeId: leave.employeeId, dealerId, date: day, status: "ON_LEAVE" },
              update: { status: "ON_LEAVE" },
            });
          }
        }
        return next;
      });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Decide leave request");
    }
  }

  // GET /api/v1/dealer-portal/hr/payroll?month=&year=
  async listPayroll(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const { month, year } = req.query as Record<string, string | undefined>;
      const where: any = { dealerId };
      if (month) where.periodMonth = parseInt(month);
      if (year) where.periodYear = parseInt(year);
      const payslips = await prisma.payslip.findMany({
        where,
        include: { employee: { select: { id: true, fullName: true, employeeCode: true, department: true } } },
        orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { id: "desc" }],
      });
      res.json({ payslips });
    } catch (error) {
      handleError(error, res, "List payroll");
    }
  }

  // POST /api/v1/dealer-portal/hr/payroll/generate — computes one payslip per
  // active employee from that month's real attendance records; refuses to
  // fabricate a payslip for anyone with zero attendance marked that month.
  async generatePayroll(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const b = req.body ?? {};
      const month = parseInt(b.month);
      const year = parseInt(b.year);
      if (!month || !year) {
        return handleValidationError(res, "month and year are required", "body", "Generate payroll");
      }
      const allowances = b.allowances ? String(b.allowances) : "0";
      const deductions = b.deductions ? String(b.deductions) : "0";

      const employees = await prisma.employee.findMany({ where: { dealerId, status: { in: ["ACTIVE", "ON_LEAVE"] } } });
      const periodStart = new Date(Date.UTC(year, month - 1, 1));
      const periodEnd = new Date(Date.UTC(year, month, 1));
      const totalDaysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

      const results: any[] = [];
      const skipped: string[] = [];
      for (const employee of employees) {
        if (employee.monthlySalary == null) {
          skipped.push(`${employee.fullName} — no monthly salary on file`);
          continue;
        }
        const existing = await prisma.payslip.findUnique({
          where: { employeeId_periodMonth_periodYear: { employeeId: employee.id, periodMonth: month, periodYear: year } },
        });
        if (existing?.status === "PAID") {
          skipped.push(`${employee.fullName} — already paid for this period, not regenerated`);
          continue;
        }
        const attendance = await prisma.attendanceRecord.findMany({
          where: { employeeId: employee.id, date: { gte: periodStart, lt: periodEnd } },
        });
        if (attendance.length === 0) {
          skipped.push(`${employee.fullName} — no attendance recorded for this period`);
          continue;
        }
        const presentDays = attendance.filter((a) => a.status === "PRESENT").length + attendance.filter((a) => a.status === "HALF_DAY").length * 0.5;
        const daysOnLeave = attendance.filter((a) => a.status === "ON_LEAVE").length;
        const payableDays = presentDays + daysOnLeave;
        const basicPay = Number(employee.monthlySalary);
        const netPay = Math.round((basicPay * (payableDays / totalDaysInMonth) + Number(allowances) - Number(deductions)) * 100) / 100;

        const payslip = await prisma.payslip.upsert({
          where: { employeeId_periodMonth_periodYear: { employeeId: employee.id, periodMonth: month, periodYear: year } },
          create: {
            employeeId: employee.id,
            dealerId,
            periodMonth: month,
            periodYear: year,
            basicPay: String(basicPay),
            allowances,
            deductions,
            daysPresent: Math.round(presentDays),
            daysOnLeave,
            netPay: String(netPay),
          },
          update: {
            basicPay: String(basicPay),
            allowances,
            deductions,
            daysPresent: Math.round(presentDays),
            daysOnLeave,
            netPay: String(netPay),
          },
        });
        results.push(payslip);
      }
      res.status(201).json({ payslips: results, skipped });
    } catch (error) {
      handleError(error, res, "Generate payroll");
    }
  }

  // PATCH /api/v1/dealer-portal/hr/payroll/:id — mark a payslip paid
  async markPayslipPaid(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const id = parseInt(req.params.id as string);
      const payslip = await prisma.payslip.findFirst({ where: { id, dealerId } });
      if (!payslip) return handleNotFoundError(res, "Payslip", "Mark payslip paid");
      const updated = await prisma.payslip.update({ where: { id }, data: { status: "PAID", paidAt: new Date() } });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Mark payslip paid");
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
}
