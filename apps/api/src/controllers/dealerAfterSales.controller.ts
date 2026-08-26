// ============================================================================
// Dealer Management — finance facilitation + after-sales controllers
// ============================================================================
// Two of Luxus Green Mobility's key dealer-retention pillars:
//   - FinanceController: the NBFC/bank bridge (buyer finance pipeline)
//   - AfterSalesController: service tickets + spare-part requests
// Copied from the delivered bundle with no changes — no Postgres-specific
// query syntax in this file.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { generateSequenceNumber, normalizePhone } from "../services/dealerManagement.service.js";
import { issueInvoice, resolveUnitPrice } from "../services/invoice.service.js";
import { sendInvoiceEmail, sendFinanceCaseStatusEmail, sendSparePartReturnStatusEmail } from "../services/email.service.js";
import { logInventoryChange } from "../services/inventoryLog.service.js";

// Same demo-login guard as orderManagement.controller.ts's actingUserId.
function actingUserId(req: Request): number | null {
  const id = (req as any).user?.id;
  return typeof id === "number" && id > 0 ? id : null;
}

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

  // GET /api/v1/finance-cases/new-count — same "unseen work" signal Order
  // Management's sidebar asterisk uses: NEW is the one status that genuinely
  // needs a staff finance person to pick it up. Must stay mounted before
  // any /:id route.
  async newCount(_req: Request, res: Response) {
    try {
      const where = { status: "NEW" as const };
      const [count, latest] = await Promise.all([
        prisma.financeCase.count({ where }),
        prisma.financeCase.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      ]);
      res.json({ count, latestCreatedAt: latest?.createdAt ?? null });
    } catch (error) {
      handleError(error, res, "Finance cases new-count");
    }
  }

  // GET /api/v1/finance-cases/:id/attachments — staff-side counterpart of the
  // dealer-portal generic Attachment endpoints (dealerPortal.controller.ts),
  // duplicated rather than shared for the same reason warranty.controller.ts's
  // WarrantyClaimController#listAttachments is: staff auth (crm_session,
  // req.user) and dealer auth (dealer_session, req.dealerPortal) are
  // different trust domains with no common middleware to hang a shared
  // handler off of.
  async listAttachments(req: Request, res: Response) {
    try {
      const financeCaseId = parseInt(req.params.id as string);
      const attachments = await prisma.attachment.findMany({
        where: { kind: "FINANCE_CASE", financeCaseId },
        orderBy: { createdAt: "desc" },
      });
      res.json({ attachments });
    } catch (error) {
      handleError(error, res, "List finance case attachments");
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
      const current = await prisma.financeCase.findUnique({ where: { id }, select: { status: true } });
      if (!current) return handleNotFoundError(res, "Finance case", "Update finance case");

      const data: any = {};
      for (const f of ["status", "financierName", "loanAmount", "vehicleModel", "notes"]) {
        if (b[f] !== undefined) data[f] = b[f];
      }
      const fc = await prisma.financeCase.update({
        where: { id },
        data,
        include: { dealer: { select: { legalName: true, tradeName: true, email: true } } },
      });

      // Every staff-driven status change closes the loop back to the dealer,
      // same "the app tells you" contract Order Management/Warranty already
      // give — fire-and-forget, never blocks the update itself.
      if (data.status && data.status !== current.status) void sendFinanceCaseStatusEmail(fc);

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
  //   REQUESTED -> APPROVED and any Close transition must go through
  //   Order Management's Check Inventory / Close Orders endpoints
  //   (orderManagement.controller.ts) so a spare-part order can't be
  //   confirmed without a stock check ever running.
  async updateSparePart(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Request ID is required", "id", "Update spare request");
      const b = req.body ?? {};

      let current: any = null;
      if (b.status !== undefined) {
        current = await prisma.sparePartRequest.findUnique({ where: { id } });
        if (!current) return handleNotFoundError(res, "Spare request", "Update spare request");
        if (current.status === "REQUESTED" && b.status === "APPROVED") {
          return handleValidationError(res, "Run Check Inventory before approving a requested order", "status", "Update spare request");
        }
        if (b.status === "Close") {
          return handleValidationError(res, "Close status is only set by Check Inventory", "status", "Update spare request");
        }
        if (current.status === "Close") {
          return handleValidationError(res, "This order is Close — use the Close Orders actions", "status", "Update spare request");
        }
      }

      const data: any = {};
      for (const f of ["status", "quantity", "partCode"]) if (b[f] !== undefined) data[f] = b[f];
      if (b.status === "DISPATCHED") data.dispatchedAt = new Date();
      if (b.status === "DELIVERED") data.deliveredAt = new Date();

      // Same "invoice per status change" pattern as the vehicle stock-
      // transfer PATCH (dealerInventory.controller.ts#update) — dispatch and
      // delivery are each a real document the dealer must receive.
      let invoice = null;
      if (current && (b.status === "DISPATCHED" || b.status === "DELIVERED")) {
        const unitPrice = await resolveUnitPrice("SPARE_PART", current);
        const result = await prisma.$transaction(async (tx) => {
          const request = await tx.sparePartRequest.update({ where: { id }, data });

          // Delivery is the actual physical stock movement: the quantity
          // the dealer ordered lands in their own DealerSparePart bucket
          // (top-up if they already stock this part, same convention as the
          // dealer's own manual/OCR add-stock flow) and comes back out of
          // the OEM's shared SparePartInventory pool — clamped at 0 so an
          // over-committed order can never drive the OEM count negative.
          let inventoryChange = null;
          if (b.status === "DELIVERED") {
            const deliveredQty = data.quantity ?? current.quantity;
            const existingStock = await tx.dealerSparePart.findFirst({ where: { dealerId: current.dealerId, partName: current.partName } });
            if (existingStock) {
              await tx.dealerSparePart.update({
                where: { id: existingStock.id },
                data: { quantityOnHand: { increment: deliveredQty }, ...(current.partCode ? { partCode: current.partCode } : {}) },
              });
            } else {
              await tx.dealerSparePart.create({
                data: { dealerId: current.dealerId, partName: current.partName, partCode: current.partCode ?? null, quantityOnHand: deliveredQty, unitPrice: String(unitPrice) },
              });
            }
            await logInventoryChange(tx, { entity: "SPARE_PART", bucket: "DEALER", direction: "ADDED", quantity: deliveredQty, itemLabel: current.partName, dealerId: current.dealerId, source: "ORDER_DELIVERED" });

            let oemRemoved = 0;
            const oemStock = await tx.sparePartInventory.findUnique({ where: { partName: current.partName } });
            if (oemStock) {
              oemRemoved = Math.min(deliveredQty, oemStock.quantityOnHand);
              await tx.sparePartInventory.update({
                where: { id: oemStock.id },
                data: { quantityOnHand: Math.max(0, oemStock.quantityOnHand - deliveredQty) },
              });
              await logInventoryChange(tx, { entity: "SPARE_PART", bucket: "OEM", direction: "REMOVED", quantity: oemRemoved, itemLabel: current.partName, source: "ORDER_DELIVERED" });
            }

            // Surfaced back to Order Management so whoever just approved the
            // delivery sees the actual inventory impact immediately.
            inventoryChange = { entity: "SPARE_PART", item: current.partName, dealerAdded: deliveredQty, oemRemoved };
          }

          const invoice = await issueInvoice(tx, {
            type: "SPARE_PART", orderId: id, dealerId: current.dealerId, item: current.partName,
            invoiceType: b.status === "DISPATCHED" ? "DISPATCH" : "DELIVERY",
            requestedQuantity: current.quantity, fulfilledQuantity: current.quantity,
            unitPrice, issuedById: actingUserId(req),
          });
          return { request, invoice, inventoryChange };
        });
        void sendInvoiceEmail(result.invoice);
        res.json({ ...result.request, invoice: result.invoice, inventoryChange: result.inventoryChange });
        return;
      }

      const request = await prisma.sparePartRequest.update({ where: { id }, data });
      res.json(request);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Spare request", "Update spare request");
      handleError(error, res, "Update spare request");
    }
  }
}

// --------------------------- SPARE PART INVENTORY ---------------------------
// Manufacturer stock-on-hand catalog, used by Order Management's Check
// Inventory comparison for spare-part orders (vehicles already have VIN-level
// truth via VehicleUnit; spare parts had none until this).
export class SparePartInventoryController {
  // GET /api/v1/spare-part-inventory (?search=)
  async list(req: Request, res: Response) {
    try {
      const { search } = req.query;
      const where: any = search
        ? { OR: [{ partName: { contains: search as string, mode: "insensitive" } }, { partCode: { contains: search as string, mode: "insensitive" } }] }
        : {};
      const items = await prisma.sparePartInventory.findMany({ where, orderBy: { partName: "asc" } });
      res.json({ items });
    } catch (error) {
      handleError(error, res, "List spare part inventory");
    }
  }

  // POST /api/v1/spare-part-inventory — catalog a part with its stock count
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.partName) return handleValidationError(res, "partName is required", "partName", "Create spare part inventory");
      const item = await prisma.sparePartInventory.create({
        data: { partName: b.partName, partCode: b.partCode ?? null, quantityOnHand: b.quantityOnHand ? parseInt(b.quantityOnHand) : 0 },
      });
      res.status(201).json(item);
    } catch (error) {
      handleError(error, res, "Create spare part inventory");
    }
  }

  // PATCH /api/v1/spare-part-inventory/:id — body: { quantityOnHand }
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Inventory ID is required", "id", "Update spare part inventory");
      const b = req.body ?? {};
      const data: any = {};
      if (b.quantityOnHand !== undefined) data.quantityOnHand = parseInt(b.quantityOnHand);
      if (b.partCode !== undefined) data.partCode = b.partCode;
      const item = await prisma.sparePartInventory.update({ where: { id }, data });
      res.json(item);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Spare part inventory", "Update spare part inventory");
      handleError(error, res, "Update spare part inventory");
    }
  }
}

// --------------------------- SPARE PART RETURNS -----------------------------
// The closed loop for "this part failed quality": a dealer flags it from
// their own stock (dealerPortal.controller.ts#createSparePartReturn, no
// stock movement yet); staff review here and resolve it, which is the
// actual physical/financial event.
export class SparePartReturnController {
  // GET /api/v1/spare-part-returns/new-count — same "unseen work" signal
  // every other module's sidebar asterisk uses: REQUESTED is the one status
  // that genuinely needs a staff decision. Must stay mounted before /:id.
  async newCount(_req: Request, res: Response) {
    try {
      const where = { status: "REQUESTED" as const };
      const [count, latest] = await Promise.all([
        prisma.sparePartReturn.count({ where }),
        prisma.sparePartReturn.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      ]);
      res.json({ count, latestCreatedAt: latest?.createdAt ?? null });
    } catch (error) {
      handleError(error, res, "Spare part returns new-count");
    }
  }

  // GET /api/v1/spare-part-returns/:id/attachments — staff-side counterpart
  // of the dealer-portal generic Attachment endpoints, same duplicated-
  // trust-domain reasoning as WarrantyClaimController#listAttachments and
  // FinanceController#listAttachments.
  async listAttachments(req: Request, res: Response) {
    try {
      const sparePartReturnId = parseInt(req.params.id as string);
      const attachments = await prisma.attachment.findMany({
        where: { kind: "SPARE_PART_RETURN", sparePartReturnId },
        orderBy: { createdAt: "desc" },
      });
      res.json({ attachments });
    } catch (error) {
      handleError(error, res, "List spare part return attachments");
    }
  }

  // GET /api/v1/spare-part-returns  (?dealerId=&status=)
  async list(req: Request, res: Response) {
    try {
      const { dealerId, status } = req.query;
      const where: any = {};
      if (dealerId) where.dealerId = parseInt(dealerId as string);
      if (status) where.status = status;

      const [returns, pipeline] = await Promise.all([
        prisma.sparePartReturn.findMany({
          where,
          include: { dealer: { select: { id: true, dealerCode: true, legalName: true } } },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
        prisma.sparePartReturn.groupBy({ by: ["status"], _count: true, where: dealerId ? { dealerId: parseInt(dealerId as string) } : {} }),
      ]);

      res.json({ returns, pipeline: Object.fromEntries(pipeline.map((r) => [r.status, r._count])) });
    } catch (error) {
      handleError(error, res, "List spare part returns");
    }
  }

  // POST /api/v1/spare-part-returns/:id/status
  //   body: { status: 'APPROVED'|'REJECTED'|'RESOLVED', resolution?: 'REPLACED'|'CREDITED', staffNotes? }
  //
  // REQUESTED -> APPROVED/REJECTED: no stock movement, just the decision.
  // -> RESOLVED (requires a resolution): the actual event. The bad quantity
  // always leaves the dealer's stock. REPLACED additionally sends a fresh
  // unit back out — dealer stock re-added, OEM SparePartInventory drawn
  // down by the same amount, exactly the "both pools move together"
  // contract dealerAfterSales.controller.ts#updateSparePart's delivery
  // reconciliation already uses. CREDITED is a financial settlement only —
  // no replacement unit, so no OEM stock change.
  async setStatus(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Return ID is required", "id", "Update spare part return status");
      const status = req.body?.status;
      if (!status) return handleValidationError(res, "status is required", "status", "Update spare part return status");
      const resolution = req.body?.resolution;
      const staffNotes: string | undefined = req.body?.staffNotes;

      const current = await prisma.sparePartReturn.findUnique({ where: { id } });
      if (!current) return handleNotFoundError(res, "Spare part return", "Update spare part return status");
      if (current.status === "RESOLVED") {
        return handleValidationError(res, "This return is already resolved", "status", "Update spare part return status");
      }
      if (status === "RESOLVED" && !["REPLACED", "CREDITED"].includes(resolution)) {
        return handleValidationError(res, "resolution must be REPLACED or CREDITED to resolve a return", "resolution", "Update spare part return status");
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (status === "RESOLVED") {
          const existingStock = await tx.dealerSparePart.findFirst({ where: { dealerId: current.dealerId, partName: current.partName } });
          if (existingStock) {
            await tx.dealerSparePart.update({
              where: { id: existingStock.id },
              data: { quantityOnHand: { decrement: Math.min(current.quantity, existingStock.quantityOnHand) } },
            });
          }
          await logInventoryChange(tx, { entity: "SPARE_PART", bucket: "DEALER", direction: "REMOVED", quantity: current.quantity, itemLabel: current.partName, dealerId: current.dealerId, source: "QUALITY_RETURN" });

          if (resolution === "REPLACED") {
            if (existingStock) {
              await tx.dealerSparePart.update({
                where: { id: existingStock.id },
                data: { quantityOnHand: { increment: current.quantity } },
              });
            } else {
              await tx.dealerSparePart.create({
                data: { dealerId: current.dealerId, partName: current.partName, partCode: current.partCode, quantityOnHand: current.quantity, unitPrice: "0" },
              });
            }
            await logInventoryChange(tx, { entity: "SPARE_PART", bucket: "DEALER", direction: "ADDED", quantity: current.quantity, itemLabel: current.partName, dealerId: current.dealerId, source: "QUALITY_RETURN_REPLACEMENT" });

            const oemStock = await tx.sparePartInventory.findUnique({ where: { partName: current.partName } });
            if (oemStock) {
              const oemRemoved = Math.min(current.quantity, oemStock.quantityOnHand);
              await tx.sparePartInventory.update({ where: { id: oemStock.id }, data: { quantityOnHand: Math.max(0, oemStock.quantityOnHand - current.quantity) } });
              await logInventoryChange(tx, { entity: "SPARE_PART", bucket: "OEM", direction: "REMOVED", quantity: oemRemoved, itemLabel: current.partName, source: "QUALITY_RETURN_REPLACEMENT" });
            }
          }
        }

        return tx.sparePartReturn.update({
          where: { id },
          data: {
            status,
            resolution: status === "RESOLVED" ? resolution : undefined,
            staffNotes: staffNotes !== undefined ? staffNotes : undefined,
            resolvedAt: status === "RESOLVED" ? new Date() : undefined,
          },
          include: { dealer: { select: { legalName: true, tradeName: true, email: true } } },
        });
      });

      void sendSparePartReturnStatusEmail(updated);

      res.json(updated);
    } catch (error) {
      handleError(error, res, "Update spare part return status");
    }
  }
}
