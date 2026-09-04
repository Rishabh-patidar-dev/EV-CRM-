// ============================================================================
// Dealer Management — finance + after-sales controllers
// ============================================================================
// Three staff-side controllers that all hang off the dealer relationship:
//   - FinanceController          — dealer receivables (billed / collected /
//                                  outstanding / aging), the manufacturer's
//                                  own money view. Not a buyer-loan desk:
//                                  retail financing is the dealer's business,
//                                  not something the OEM's ERP tracks.
//   - AfterSalesController       — service tickets + spare-part requests
//   - SparePartInventoryController — the OEM's spare-part stock catalog
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { generateSequenceNumber, normalizePhone } from "../services/dealerManagement.service.js";
import { issueInvoice, resolveUnitPrice } from "../services/invoice.service.js";
import { sendInvoiceEmail } from "../services/email.service.js";
import { logInventoryChange } from "../services/inventoryLog.service.js";
import {
  BILLABLE_INVOICE_TYPES,
  settleInvoices,
  bucketAging,
  overdueAmount,
  type AgingBuckets,
} from "../services/receivables.service.js";

// Same demo-login guard as orderManagement.controller.ts's actingUserId.
function actingUserId(req: Request): number | null {
  const id = (req as any).user?.id;
  return typeof id === "number" && id > 0 ? id : null;
}

// ------------------------------- FINANCE ------------------------------------
// Manufacturer-side finance: what each dealer has been billed, what they've
// paid, what's still open against their credit limit, and how old that
// balance is. See services/receivables.service.ts for the two rules the
// whole module rests on (only delivered goods create a payable; outstanding
// is always computed FIFO, never stored).
export class FinanceController {
  // GET /api/v1/finance/summary — the headline numbers + network-wide aging.
  async summary(_req: Request, res: Response) {
    try {
      const [invoices, payments, dealerCount] = await Promise.all([
        prisma.invoice.findMany({
          where: { type: { in: [...BILLABLE_INVOICE_TYPES] } },
          select: { id: true, invoiceNumber: true, item: true, issuedAt: true, totalAmount: true, dealerId: true },
        }),
        prisma.dealerPayment.findMany({ select: { amount: true, invoiceId: true, dealerId: true } }),
        prisma.dealer.count(),
      ]);

      // Allocation is per dealer — one dealer's payment can never settle
      // another's invoice, so the FIFO queue has to be run per ledger.
      const byDealer = new Map<number, { invoices: typeof invoices; payments: typeof payments }>();
      for (const inv of invoices) {
        if (!byDealer.has(inv.dealerId)) byDealer.set(inv.dealerId, { invoices: [], payments: [] });
        byDealer.get(inv.dealerId)!.invoices.push(inv);
      }
      for (const p of payments) {
        if (!byDealer.has(p.dealerId)) byDealer.set(p.dealerId, { invoices: [], payments: [] });
        byDealer.get(p.dealerId)!.payments.push(p);
      }

      const aging: AgingBuckets = { current: 0, d30: 0, d60: 0, d90plus: 0 };
      let outstanding = 0;
      let overdue = 0;
      let dealersWithBalance = 0;

      for (const { invoices: inv, payments: pay } of byDealer.values()) {
        const settled = settleInvoices(inv, pay);
        const dealerOutstanding = settled.reduce((s, i) => s + i.balance, 0);
        outstanding += dealerOutstanding;
        overdue += overdueAmount(settled);
        if (dealerOutstanding > 0.005) dealersWithBalance++;
        const b = bucketAging(settled);
        aging.current += b.current;
        aging.d30 += b.d30;
        aging.d60 += b.d60;
        aging.d90plus += b.d90plus;
      }

      const totalBilled = invoices.reduce((s, i) => s + Number(i.totalAmount ?? 0), 0);
      const totalCollected = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);

      res.json({
        totalBilled: Math.round(totalBilled),
        totalCollected: Math.round(totalCollected),
        outstanding: Math.round(outstanding),
        overdue: Math.round(overdue),
        dealerCount,
        dealersWithBalance,
        aging: {
          current: Math.round(aging.current),
          d30: Math.round(aging.d30),
          d60: Math.round(aging.d60),
          d90plus: Math.round(aging.d90plus),
        },
      });
    } catch (error) {
      handleError(error, res, "Finance summary");
    }
  }

  // GET /api/v1/finance/dealers — one row per dealer: billed, collected,
  // outstanding, how much of their credit limit that eats, and the age of
  // their oldest unpaid invoice.
  async dealers(req: Request, res: Response) {
    try {
      const onlyOutstanding = String(req.query.onlyOutstanding ?? "") === "true";

      const [dealers, invoices, payments] = await Promise.all([
        prisma.dealer.findMany({
          select: { id: true, dealerCode: true, legalName: true, tradeName: true, state: true, creditLimit: true, status: true },
          orderBy: { legalName: "asc" },
        }),
        prisma.invoice.findMany({
          where: { type: { in: [...BILLABLE_INVOICE_TYPES] } },
          select: { id: true, invoiceNumber: true, item: true, issuedAt: true, totalAmount: true, dealerId: true },
        }),
        prisma.dealerPayment.findMany({ select: { amount: true, invoiceId: true, dealerId: true } }),
      ]);

      const rows = dealers.map((d) => {
        const dealerInvoices = invoices.filter((i) => i.dealerId === d.id);
        const dealerPayments = payments.filter((p) => p.dealerId === d.id);
        const settled = settleInvoices(dealerInvoices, dealerPayments);

        const billed = dealerInvoices.reduce((s, i) => s + Number(i.totalAmount ?? 0), 0);
        const collected = dealerPayments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
        const outstanding = settled.reduce((s, i) => s + i.balance, 0);
        const open = settled.filter((i) => i.balance > 0);
        const creditLimit = d.creditLimit != null ? Number(d.creditLimit) : null;

        return {
          id: d.id,
          dealerCode: d.dealerCode,
          legalName: d.legalName,
          tradeName: d.tradeName,
          state: d.state,
          status: d.status,
          creditLimit,
          billed: Math.round(billed),
          collected: Math.round(collected),
          outstanding: Math.round(outstanding),
          // Null when no limit is on file — the UI shows "—" rather than
          // implying 0% utilisation of a limit that doesn't exist.
          utilisationPct: creditLimit && creditLimit > 0 ? Math.round((outstanding / creditLimit) * 100) : null,
          overLimit: creditLimit != null && creditLimit > 0 && outstanding > creditLimit,
          openInvoiceCount: open.length,
          oldestUnpaidDays: open.length > 0 ? Math.max(...open.map((i) => i.ageDays)) : 0,
          overdue: Math.round(overdueAmount(settled)),
        };
      });

      res.json({ dealers: onlyOutstanding ? rows.filter((r) => r.outstanding > 0) : rows });
    } catch (error) {
      handleError(error, res, "Finance dealer receivables");
    }
  }

  // GET /api/v1/finance/dealers/:id/ledger — the drill-down: every billable
  // invoice with how much of it is still open, plus the payment history.
  async ledger(req: Request, res: Response) {
    try {
      const dealerId = parseInt(req.params.id as string);
      if (!dealerId) return handleValidationError(res, "Dealer ID is required", "id", "Dealer ledger");

      const dealer = await prisma.dealer.findUnique({
        where: { id: dealerId },
        select: { id: true, dealerCode: true, legalName: true, tradeName: true, email: true, phone: true, state: true, creditLimit: true, securityDeposit: true },
      });
      if (!dealer) return handleNotFoundError(res, "Dealer", "Dealer ledger");

      const [invoices, payments] = await Promise.all([
        prisma.invoice.findMany({
          where: { dealerId, type: { in: [...BILLABLE_INVOICE_TYPES] } },
          select: { id: true, invoiceNumber: true, item: true, issuedAt: true, totalAmount: true, type: true },
          orderBy: { issuedAt: "desc" },
        }),
        prisma.dealerPayment.findMany({
          where: { dealerId },
          include: {
            invoice: { select: { id: true, invoiceNumber: true } },
            recordedBy: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { paidAt: "desc" },
        }),
      ]);

      const settled = settleInvoices(invoices, payments);
      const settledById = new Map(settled.map((s) => [s.id, s]));
      const outstanding = settled.reduce((s, i) => s + i.balance, 0);

      res.json({
        dealer: {
          ...dealer,
          creditLimit: dealer.creditLimit != null ? Number(dealer.creditLimit) : null,
          securityDeposit: dealer.securityDeposit != null ? Number(dealer.securityDeposit) : null,
        },
        invoices: invoices.map((i) => {
          const s = settledById.get(i.id);
          return {
            id: i.id,
            invoiceNumber: i.invoiceNumber,
            item: i.item,
            type: i.type,
            issuedAt: i.issuedAt,
            amount: Math.round(Number(i.totalAmount ?? 0)),
            paid: Math.round(s?.paid ?? 0),
            balance: Math.round(s?.balance ?? 0),
            ageDays: s?.ageDays ?? 0,
            settled: s?.settled ?? false,
          };
        }),
        payments,
        totals: {
          billed: Math.round(invoices.reduce((s, i) => s + Number(i.totalAmount ?? 0), 0)),
          collected: Math.round(payments.reduce((s, p) => s + Number(p.amount ?? 0), 0)),
          outstanding: Math.round(outstanding),
          overdue: Math.round(overdueAmount(settled)),
        },
        aging: bucketAging(settled),
      });
    } catch (error) {
      handleError(error, res, "Dealer ledger");
    }
  }

  // POST /api/v1/finance/payments — record money received from a dealer.
  //   body: { dealerId, amount, mode?, referenceNumber?, paidAt?, invoiceId?, notes? }
  async recordPayment(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      const dealerId = parseInt(b.dealerId);
      const amount = Number(b.amount);
      if (!dealerId || !(amount > 0)) {
        return handleValidationError(res, "dealerId and a positive amount are required", "body", "Record payment");
      }

      const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, select: { id: true } });
      if (!dealer) return handleNotFoundError(res, "Dealer", "Record payment");

      // An invoice can only be tagged if it actually belongs to this dealer —
      // otherwise a typo would silently settle someone else's balance.
      let invoiceId: number | null = null;
      if (b.invoiceId) {
        const invoice = await prisma.invoice.findFirst({ where: { id: parseInt(b.invoiceId), dealerId }, select: { id: true } });
        if (!invoice) return handleValidationError(res, "That invoice doesn't belong to this dealer", "invoiceId", "Record payment");
        invoiceId = invoice.id;
      }

      const payment = await prisma.dealerPayment.create({
        data: {
          dealerId,
          amount: String(amount),
          mode: b.mode ?? "BANK_TRANSFER",
          referenceNumber: b.referenceNumber || null,
          paidAt: b.paidAt ? new Date(b.paidAt) : new Date(),
          notes: b.notes || null,
          invoiceId,
          recordedById: actingUserId(req),
        },
        include: { dealer: { select: { id: true, dealerCode: true, legalName: true } } },
      });

      res.status(201).json(payment);
    } catch (error) {
      handleError(error, res, "Record payment");
    }
  }

  // GET /api/v1/finance/payments  (?dealerId=&limit=)
  async listPayments(req: Request, res: Response) {
    try {
      const { dealerId, limit = "100" } = req.query;
      const where: any = {};
      if (dealerId) where.dealerId = parseInt(dealerId as string);

      const payments = await prisma.dealerPayment.findMany({
        where,
        include: {
          dealer: { select: { id: true, dealerCode: true, legalName: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
          recordedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { paidAt: "desc" },
        take: Math.min(500, Math.max(1, parseInt(limit as string) || 100)),
      });
      res.json({ payments });
    } catch (error) {
      handleError(error, res, "List payments");
    }
  }

  // DELETE /api/v1/finance/payments/:id — undo a mis-keyed receipt. The
  // ledger is derived, so removing the row is enough to correct every
  // downstream number.
  async deletePayment(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Payment ID is required", "id", "Delete payment");
      await prisma.dealerPayment.delete({ where: { id } });
      res.status(204).send();
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Payment", "Delete payment");
      handleError(error, res, "Delete payment");
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
