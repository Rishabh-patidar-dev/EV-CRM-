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
import { generateSequenceNumber } from "../services/dealerManagement.service.js";
import { submitWarrantyClaim } from "../services/warrantyAdjudication.service.js";

export class DealerPortalController {
  // GET /api/v1/dealer-portal/overview
  async overview(req: Request, res: Response) {
    try {
      const { dealerId, dealerCode, legalName, status } = req.dealerPortal!;
      const [vehicleCount, openTransfers, openSpareParts, openTickets, openClaims] = await Promise.all([
        prisma.vehicleUnit.count({ where: { dealerId } }),
        prisma.stockTransferRequest.count({ where: { dealerId, status: { in: ["REQUESTED", "APPROVED", "DISPATCHED"] } } }),
        prisma.sparePartRequest.count({ where: { dealerId, status: { in: ["REQUESTED", "APPROVED", "DISPATCHED"] } } }),
        prisma.serviceTicket.count({ where: { dealerId, status: { in: ["OPEN", "IN_PROGRESS", "AWAITING_PARTS"] } } }),
        prisma.warrantyClaim.count({ where: { dealerId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "INFO_REQUESTED", "APPROVED", "IN_REPAIR"] } } }),
      ]);
      res.json({
        dealer: { id: dealerId, dealerCode, legalName, status },
        vehicleCount,
        openTransfers,
        openSpareParts,
        openTickets,
        openClaims,
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

      const [units, total] = await Promise.all([
        prisma.vehicleUnit.findMany({ where, orderBy: { createdAt: "desc" }, skip: (pageNum - 1) * limitNum, take: limitNum }),
        prisma.vehicleUnit.count({ where }),
      ]);
      res.json({ units, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
    } catch (error) {
      handleError(error, res, "List dealer vehicle units");
    }
  }

  // GET /api/v1/dealer-portal/stock-transfers
  async listStockTransfers(req: Request, res: Response) {
    try {
      const { dealerId } = req.dealerPortal!;
      const transfers = await prisma.stockTransferRequest.findMany({ where: { dealerId }, orderBy: { createdAt: "desc" }, take: 100 });
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
      const spareParts = await prisma.sparePartRequest.findMany({ where: { dealerId }, orderBy: { createdAt: "desc" }, take: 100 });
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
        },
      });
      res.status(201).json(sparePart);
    } catch (error) {
      handleError(error, res, "Place spare-part order");
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
}
