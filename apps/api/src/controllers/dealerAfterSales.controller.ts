// ============================================================================
// Dealer Management — finance facilitation + after-sales controllers
// ============================================================================
// Two of EV Vikas's key dealer-retention pillars:
//   - FinanceController: the NBFC/bank bridge (buyer finance pipeline)
//   - AfterSalesController: service tickets + spare-part requests
// Copied from the delivered bundle with no changes — no Postgres-specific
// query syntax in this file.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { generateSequenceNumber, normalizePhone } from "../services/dealerManagement.service.js";

// ------------------------------- FINANCE ------------------------------------
export class FinanceController {
  // POST /api/v1/finance-cases
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.dealerId || !b.buyerName || !b.buyerPhone) {
        return handleValidationError(
          res,
          "dealerId, buyerName and buyerPhone are required",
          "body",
          "Create finance case"
        );
      }
      const fc = await prisma.financeCase.create({
        data: {
          dealerId: parseInt(b.dealerId),
          leadId: b.leadId ?? null,
          buyerName: b.buyerName,
          buyerPhone: normalizePhone(b.buyerPhone) ?? b.buyerPhone,
          vehicleModel: b.vehicleModel ?? null,
          loanAmount: b.loanAmount ?? null,
          financierName: b.financierName ?? null,
          status: b.status ?? "NEW",
          notes: b.notes ?? null,
        },
      });
      res.status(201).json(fc);
    } catch (error) {
      handleError(error, res, "Create finance case");
    }
  }

  // GET /api/v1/finance-cases  (?dealerId= &status= )
  async list(req: Request, res: Response) {
    try {
      const { dealerId, status, page = "1", limit = "20" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));

      const where: any = {};
      if (dealerId) where.dealerId = parseInt(dealerId as string);
      if (status) where.status = status;

      const [items, total, pipeline] = await Promise.all([
        prisma.financeCase.findMany({
          where,
          include: { dealer: { select: { id: true, dealerCode: true, legalName: true } } },
          orderBy: { createdAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.financeCase.count({ where }),
        prisma.financeCase.groupBy({ by: ["status"], _count: true, where: dealerId ? { dealerId: parseInt(dealerId as string) } : {} }),
      ]);

      res.json({
        financeCases: items,
        pipeline: Object.fromEntries(pipeline.map((r) => [r.status, r._count])),
        pagination: { total, page: pageNum, limit: limitNum },
      });
    } catch (error) {
      handleError(error, res, "List finance cases");
    }
  }

  // PATCH /api/v1/finance-cases/:id  — advance status / edit
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Case ID is required", "id", "Update finance case");
      const b = req.body ?? {};
      const data: any = {};
      for (const f of ["status", "financierName", "loanAmount", "vehicleModel", "notes"]) {
        if (b[f] !== undefined) data[f] = b[f];
      }
      const fc = await prisma.financeCase.update({ where: { id }, data });
      res.json(fc);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Finance case", "Update finance case");
      handleError(error, res, "Update finance case");
    }
  }
}

// ----------------------------- AFTER-SALES ----------------------------------
export class AfterSalesController {
  // ---- Service tickets ----
  // POST /api/v1/service-tickets
  async createTicket(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.dealerId || !b.customerName || !b.issue) {
        return handleValidationError(
          res,
          "dealerId, customerName and issue are required",
          "body",
          "Create service ticket"
        );
      }
      const ticketNumber = await generateSequenceNumber("SVC", () => prisma.serviceTicket.count());
      const ticket = await prisma.serviceTicket.create({
        data: {
          ticketNumber,
          dealerId: parseInt(b.dealerId),
          customerName: b.customerName,
          customerPhone: b.customerPhone ? (normalizePhone(b.customerPhone) ?? b.customerPhone) : null,
          vehicleModel: b.vehicleModel ?? null,
          chassisNumber: b.chassisNumber ?? null,
          issue: b.issue,
          priority: b.priority ?? "NORMAL",
          status: b.status ?? "OPEN",
        },
      });
      res.status(201).json(ticket);
    } catch (error) {
      handleError(error, res, "Create service ticket");
    }
  }

  // GET /api/v1/service-tickets  (?dealerId= &status= &priority= )
  async listTickets(req: Request, res: Response) {
    try {
      const { dealerId, status, priority, page = "1", limit = "20" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));

      const where: any = {};
      if (dealerId) where.dealerId = parseInt(dealerId as string);
      if (status) where.status = status;
      if (priority) where.priority = priority;

      const [items, total] = await Promise.all([
        prisma.serviceTicket.findMany({
          where,
          include: { dealer: { select: { id: true, dealerCode: true, legalName: true } } },
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.serviceTicket.count({ where }),
      ]);
      res.json({ tickets: items, pagination: { total, page: pageNum, limit: limitNum } });
    } catch (error) {
      handleError(error, res, "List service tickets");
    }
  }

  // PATCH /api/v1/service-tickets/:id
  async updateTicket(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Ticket ID is required", "id", "Update ticket");
      const b = req.body ?? {};
      const data: any = {};
      for (const f of ["status", "priority", "issue"]) if (b[f] !== undefined) data[f] = b[f];
      if (b.status === "RESOLVED" || b.status === "CLOSED") data.resolvedAt = new Date();
      const ticket = await prisma.serviceTicket.update({ where: { id }, data });
      res.json(ticket);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Service ticket", "Update ticket");
      handleError(error, res, "Update ticket");
    }
  }

  // ---- Spare-part requests ----
  // POST /api/v1/spare-parts
  async createSparePart(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.dealerId || !b.partName) {
        return handleValidationError(res, "dealerId and partName are required", "body", "Create spare request");
      }
      const requestNumber = await generateSequenceNumber("SPR", () => prisma.sparePartRequest.count());
      const request = await prisma.sparePartRequest.create({
        data: {
          requestNumber,
          dealerId: parseInt(b.dealerId),
          partName: b.partName,
          partCode: b.partCode ?? null,
          quantity: b.quantity ?? 1,
          status: b.status ?? "REQUESTED",
        },
      });
      res.status(201).json(request);
    } catch (error) {
      handleError(error, res, "Create spare request");
    }
  }

  // GET /api/v1/spare-parts  (?dealerId= &status= )
  async listSpareParts(req: Request, res: Response) {
    try {
      const { dealerId, status, page = "1", limit = "20" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));

      const where: any = {};
      if (dealerId) where.dealerId = parseInt(dealerId as string);
      if (status) where.status = status;

      const [items, total] = await Promise.all([
        prisma.sparePartRequest.findMany({
          where,
          include: { dealer: { select: { id: true, dealerCode: true, legalName: true } } },
          orderBy: { createdAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.sparePartRequest.count({ where }),
      ]);
      res.json({ spareParts: items, pagination: { total, page: pageNum, limit: limitNum } });
    } catch (error) {
      handleError(error, res, "List spare parts");
    }
  }

  // PATCH /api/v1/spare-parts/:id
  async updateSparePart(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Request ID is required", "id", "Update spare request");
      const b = req.body ?? {};
      const data: any = {};
      for (const f of ["status", "quantity", "partCode"]) if (b[f] !== undefined) data[f] = b[f];
      if (b.status === "DISPATCHED") data.dispatchedAt = new Date();
      const request = await prisma.sparePartRequest.update({ where: { id }, data });
      res.json(request);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Spare request", "Update spare request");
      handleError(error, res, "Update spare request");
    }
  }
}
