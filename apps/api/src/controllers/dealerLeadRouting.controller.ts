// ============================================================================
// Dealer Management — lead routing controller
// ============================================================================
// Implements EV Vikas's "leads passed to the nearest authorised dealer"
// model. A retail Lead (from the Leads module / landing page) is matched to a
// dealer by territory and handed over for follow-up. Copied from the
// delivered bundle with no changes.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { findNearestDealer } from "../services/dealerManagement.service.js";

export class DealerLeadRoutingController {
  // -------------------------------------------------------------------------
  // POST /api/v1/dealer-routing/route/:leadId
  //   Auto-route a lead to the nearest dealer by its state/city.
  //   Optional body: { dealerId } to force a manual assignment.
  // -------------------------------------------------------------------------
  async route(req: Request, res: Response) {
    try {
      const leadId = parseInt(req.params.leadId as string);
      if (!leadId) return handleValidationError(res, "leadId is required", "leadId", "Route lead");

      const lead = await prisma.lead.findFirst({ where: { id: leadId, deletedAt: null } });
      if (!lead) return handleNotFoundError(res, "Lead", "Route lead");

      // Already routed? return existing (idempotent).
      const existing = await prisma.dealerLeadAssignment.findUnique({ where: { leadId } });
      if (existing && !req.body?.dealerId) {
        return res.status(200).json({ ...existing, alreadyRouted: true });
      }

      let dealerId: number | null = req.body?.dealerId ?? null;
      let routedBy: "AUTO_TERRITORY" | "MANUAL" = dealerId ? "MANUAL" : "AUTO_TERRITORY";

      if (!dealerId) {
        dealerId = await findNearestDealer({
          state: lead.state,
          district: lead.district ?? lead.city,
        });
      }

      if (!dealerId) {
        return res.status(422).json({
          success: false,
          message: "No active dealer found for this lead's territory. Assign manually or add coverage.",
          leadState: lead.state ?? null,
        });
      }

      const assignment = await prisma.dealerLeadAssignment.upsert({
        where: { leadId },
        create: { leadId, dealerId, routedBy, status: "ASSIGNED" },
        update: { dealerId, routedBy, status: "REASSIGNED", assignedAt: new Date() },
      });

      res.status(201).json(assignment);
    } catch (error) {
      handleError(error, res, "Route lead");
    }
  }

  // -------------------------------------------------------------------------
  // GET /api/v1/dealer-routing  — list assignments (?dealerId= &status= )
  // -------------------------------------------------------------------------
  async list(req: Request, res: Response) {
    try {
      const { dealerId, status, page = "1", limit = "20" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));

      const where: any = {};
      if (dealerId) where.dealerId = parseInt(dealerId as string);
      if (status) where.status = status;

      const [items, total] = await Promise.all([
        prisma.dealerLeadAssignment.findMany({
          where,
          include: {
            dealer: { select: { id: true, dealerCode: true, legalName: true, state: true } },
            lead: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
          },
          orderBy: { assignedAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.dealerLeadAssignment.count({ where }),
      ]);

      res.json({ assignments: items, pagination: { total, page: pageNum, limit: limitNum } });
    } catch (error) {
      handleError(error, res, "List routed leads");
    }
  }

  // -------------------------------------------------------------------------
  // PATCH /api/v1/dealer-routing/:id — update status/outcome of an assignment
  // -------------------------------------------------------------------------
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Assignment ID is required", "id", "Update routing");
      const b = req.body ?? {};

      const data: any = {};
      if (b.status) data.status = b.status;
      if (b.outcome !== undefined) data.outcome = b.outcome;
      if (b.status === "CONTACTED" || b.status === "ACCEPTED") data.respondedAt = new Date();

      const updated = await prisma.dealerLeadAssignment.update({ where: { id }, data });
      res.json(updated);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Assignment", "Update routing");
      handleError(error, res, "Update routing");
    }
  }
}
