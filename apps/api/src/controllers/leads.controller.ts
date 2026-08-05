// ============================================================================
// Lead Module — ported from innocrm-staging's apps/api/src/controllers/
// leads.controller.ts (2454 lines in the original): list/detail/CRUD, the
// real scoring formula, role scoping (SALES sees only their own leads), CSV
// bulk import (leadsImport.controller.ts), bulk assign, and self-serve
// claim. Trimmed out: Contact/Account conversion and keyword tagging — this
// CRM has no Contact module, and instead a Lead converts straight into a
// DealerApplication (convertToDealer below) when the "lead" IS a potential
// dealer, which is the primary use case here.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { isValidEmail, isValidPhone, isValidName, isValidPincode } from "../utils/validators.js";
import { LeadScoringService } from "../services/leadScoring.service.js";
import { ONBOARDING_DOC_CATALOG } from "../services/applicationRouting.service.js";

const scoring = new LeadScoringService();

function scoreFor(lead: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}) {
  return scoring.calculateLeadScore({
    name: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
    email: lead.email ?? undefined,
    phone: lead.phone ?? undefined,
    companyName: lead.companyName ?? undefined,
    city: lead.city ?? undefined,
    state: lead.state ?? undefined,
    pincode: lead.pincode ?? undefined,
  });
}

export class LeadController {
  // -------------------------------------------------------------------------
  // GET /api/v1/leads — paginated, filterable list
  //   ?status= &source= &ownerId= &unassigned=true &assigned=true &search= &page= &limit=
  //   SALES users only ever see their own leads (unless asking for unassigned).
  // -------------------------------------------------------------------------
  async list(req: Request, res: Response) {
    try {
      const {
        page = "1",
        limit = "20",
        status,
        source,
        ownerId,
        unassigned,
        assigned,
        search = "",
      } = req.query;

      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
      const skip = (pageNum - 1) * limitNum;

      const where: any = { deletedAt: null };
      if (status) where.status = status.toString().includes(",") ? { in: status.toString().split(",") } : status;
      if (source) where.source = source;

      const isUnassigned = typeof unassigned === "string" && unassigned.toLowerCase() === "true";
      const isAssigned = typeof assigned === "string" && assigned.toLowerCase() === "true";
      if (isUnassigned) where.ownerId = null;
      else if (isAssigned) where.ownerId = { not: null };
      else if (ownerId) where.ownerId = parseInt(ownerId as string);

      if (search) {
        where.OR = [
          { firstName: { contains: search as string } },
          { lastName: { contains: search as string } },
          { email: { contains: search as string } },
          { phone: { contains: search as string } },
          { companyName: { contains: search as string } },
        ];
      }

      // SALES: scoped to their own leads (unless explicitly browsing unassigned).
      if (req.user?.role === "SALES") {
        where.ownerId = isUnassigned ? null : req.user.id;
      }

      const [leads, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          include: { owner: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: "desc" },
          skip,
          take: limitNum,
        }),
        prisma.lead.count({ where }),
      ]);

      res.json({
        leads,
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      });
    } catch (error) {
      handleError(error, res, "List leads");
    }
  }

  // -------------------------------------------------------------------------
  // GET /api/v1/leads/stats — pipeline counts for the dashboard
  // -------------------------------------------------------------------------
  async stats(_req: Request, res: Response) {
    try {
      const [byStatus, bySource, total, unassigned, avgScoreRow, recentLeads] = await Promise.all([
        prisma.lead.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
        prisma.lead.groupBy({ by: ["source"], where: { deletedAt: null }, _count: true }),
        prisma.lead.count({ where: { deletedAt: null } }),
        prisma.lead.count({ where: { deletedAt: null, ownerId: null } }),
        prisma.lead.aggregate({ where: { deletedAt: null }, _avg: { score: true } }),
        prisma.lead.findMany({ where: { deletedAt: null }, select: { createdAt: true, source: true } }),
      ]);

      // Weekly lead volume by source, last 8 weeks — the trend the Overview
      // dashboard's "Leads by source" chart reads (real createdAt buckets,
      // not a fabricated series).
      const SOURCES: string[] = ["LANDING_PAGE", "MANUAL", "IMPORT"];
      const DAY_MS = 86_400_000;
      const now = Date.now();
      const weekLabels: string[] = [];
      const weekBounds: { start: number; end: number }[] = [];
      for (let i = 7; i >= 0; i--) {
        const start = new Date(now - i * 7 * DAY_MS);
        start.setHours(0, 0, 0, 0);
        const end = +start + 7 * DAY_MS;
        weekLabels.push(`${start.getMonth() + 1}/${start.getDate()}`);
        weekBounds.push({ start: +start, end });
      }
      const trendSeries = SOURCES.map((source) => ({
        label: source.replace("_", " "),
        values: weekBounds.map(
          ({ start, end }) => recentLeads.filter((l) => l.source === source && +l.createdAt >= start && +l.createdAt < end).length
        ),
      }));

      res.json({
        total,
        unassigned,
        averageScore: Math.round(avgScoreRow._avg.score ?? 0),
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status ?? "UNSET", r._count])),
        bySource: Object.fromEntries(bySource.map((r) => [r.source ?? "UNSET", r._count])),
        trend: { weeks: weekLabels, series: trendSeries },
      });
    } catch (error) {
      handleError(error, res, "Lead stats");
    }
  }

  // -------------------------------------------------------------------------
  // GET /api/v1/leads/:id — full detail incl. enquiries, submissions, remarks
  // -------------------------------------------------------------------------
  async getById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Lead ID is required", "id", "Get lead");

      const lead = await prisma.lead.findUnique({
        where: { id, deletedAt: null },
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          enquiries: { orderBy: { enquiryCreatedAt: "desc" }, take: 20 },
          formSubmissions: { orderBy: { submittedAt: "desc" }, take: 10 },
          remarks: {
            orderBy: { createdAt: "desc" },
            include: { user: { select: { id: true, firstName: true, lastName: true } } },
          },
          dealerAssignment: { include: { dealer: { select: { id: true, dealerCode: true, legalName: true } } } },
          dealerApplication: { select: { id: true, publicId: true, stage: true, status: true } },
        },
      });

      if (!lead) return handleNotFoundError(res, "Lead", "Get lead");
      res.json(lead);
    } catch (error) {
      handleError(error, res, "Get lead");
    }
  }

  // -------------------------------------------------------------------------
  // POST /api/v1/leads — manual creation (walk-in / phone enquiry)
  // -------------------------------------------------------------------------
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.firstName || !isValidName(b.firstName)) {
        return handleValidationError(res, "firstName is required", "firstName", "Create lead");
      }
      if (!b.email || !isValidEmail(b.email)) {
        return handleValidationError(res, "A valid email is required", "email", "Create lead");
      }
      if (b.phone && !isValidPhone(b.phone)) {
        return handleValidationError(res, "Phone must be a valid 10-digit Indian mobile number", "phone", "Create lead");
      }
      if (b.pincode && !isValidPincode(b.pincode)) {
        return handleValidationError(res, "Pincode must be 6 digits", "pincode", "Create lead");
      }

      const scored = scoreFor(b);
      const lead = await prisma.lead.create({
        data: {
          firstName: b.firstName,
          lastName: b.lastName ?? null,
          email: b.email,
          phone: b.phone ?? null,
          companyName: b.companyName ?? null,
          city: b.city ?? null,
          state: b.state ?? null,
          pincode: b.pincode ?? null,
          source: b.source ?? "MANUAL",
          status: b.status ?? "OPEN",
          ownerId: b.ownerId ?? null,
          assignedAt: b.ownerId ? new Date() : null,
          score: scored.totalScore,
          completenessScore: scored.completenessScore,
          qualityScore: scored.qualityScore,
          missingFields: scored.missingFields,
          invalidFields: scored.invalidFields,
        },
      });
      res.status(201).json(lead);
    } catch (error) {
      handleError(error, res, "Create lead");
    }
  }

  // -------------------------------------------------------------------------
  // PATCH /api/v1/leads/:id — edit fields / change status (rescored on save)
  // -------------------------------------------------------------------------
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Lead ID is required", "id", "Update lead");

      const current = await prisma.lead.findUnique({ where: { id, deletedAt: null } });
      if (!current) return handleNotFoundError(res, "Lead", "Update lead");

      const b = req.body ?? {};
      const data: any = {};
      for (const f of ["firstName", "lastName", "email", "phone", "companyName", "city", "state", "pincode", "status"]) {
        if (b[f] !== undefined) data[f] = b[f];
      }

      const merged = { ...current, ...data };
      const scored = scoreFor(merged);
      data.score = scored.totalScore;
      data.completenessScore = scored.completenessScore;
      data.qualityScore = scored.qualityScore;
      data.missingFields = scored.missingFields;
      data.invalidFields = scored.invalidFields;

      const lead = await prisma.lead.update({ where: { id }, data });
      res.json(lead);
    } catch (error) {
      handleError(error, res, "Update lead");
    }
  }

  // -------------------------------------------------------------------------
  // PUT /api/v1/leads/:id/assign — body: { ownerId } (null to unassign)
  // -------------------------------------------------------------------------
  async assign(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Lead ID is required", "id", "Assign lead");
      const ownerId = req.body?.ownerId ? parseInt(req.body.ownerId) : null;

      const lead = await prisma.lead.update({
        where: { id },
        data: { ownerId, assignedAt: ownerId ? new Date() : null },
      });
      res.json(lead);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Lead", "Assign lead");
      handleError(error, res, "Assign lead");
    }
  }

  // -------------------------------------------------------------------------
  // POST /api/v1/leads/assign-bulk — body: { leadIds: number[], ownerId }
  // Ported from innocrm-staging's assignLeadsBulkToUser, simplified.
  // -------------------------------------------------------------------------
  async assignBulk(req: Request, res: Response) {
    try {
      const leadIds: number[] = Array.isArray(req.body?.leadIds) ? req.body.leadIds.map((n: any) => parseInt(n)) : [];
      const ownerId = req.body?.ownerId ? parseInt(req.body.ownerId) : null;
      if (leadIds.length === 0) return handleValidationError(res, "leadIds must be a non-empty array", "leadIds", "Bulk assign leads");

      const result = await prisma.lead.updateMany({
        where: { id: { in: leadIds }, deletedAt: null },
        data: { ownerId, assignedAt: ownerId ? new Date() : null },
      });
      res.json({ updatedCount: result.count });
    } catch (error) {
      handleError(error, res, "Bulk assign leads");
    }
  }

  // -------------------------------------------------------------------------
  // PUT /api/v1/leads/:id/claim — a SALES rep self-serves an unassigned lead
  // from the shared queue. Ported from innocrm-staging's claimLead: first
  // come, first served — 409s if someone already claimed it.
  // -------------------------------------------------------------------------
  async claim(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Lead ID is required", "id", "Claim lead");
      const userId = req.body?.userId ? parseInt(req.body.userId) : (req as any).user?.id;
      if (!userId) return handleValidationError(res, "userId is required", "userId", "Claim lead");

      const lead = await prisma.lead.findUnique({ where: { id, deletedAt: null } });
      if (!lead) return handleNotFoundError(res, "Lead", "Claim lead");
      if (lead.ownerId !== null) {
        return res.status(409).json({ success: false, message: "This lead has already been claimed by another user." });
      }

      const updated = await prisma.lead.update({
        where: { id },
        data: { ownerId: userId, assignedAt: new Date() },
        include: { owner: { select: { id: true, firstName: true, lastName: true } } },
      });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Claim lead");
    }
  }

  // -------------------------------------------------------------------------
  // POST /api/v1/leads/:id/convert-to-dealer — "dealer is the lead": a
  // retail/manual/imported lead who's actually expressed dealer interest
  // converts straight into a DealerApplication at stage APPLICATION,
  // seeded with the same Stage-1 document checklist the landing-page
  // dealership_application webhook path uses (applicationRouting.service.ts),
  // and the lead is marked CONVERTED with the application linked back.
  // -------------------------------------------------------------------------
  async convertToDealer(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Lead ID is required", "id", "Convert lead to dealer application");

      const lead = await prisma.lead.findUnique({ where: { id, deletedAt: null }, include: { dealerApplication: true } });
      if (!lead) return handleNotFoundError(res, "Lead", "Convert lead to dealer application");
      if (lead.dealerApplication) {
        return res.status(409).json({ success: false, message: "This lead already has a dealer application", applicationId: lead.dealerApplication.id });
      }

      const b = req.body ?? {};
      const legalName = b.legalName || lead.companyName || [lead.firstName, lead.lastName].filter(Boolean).join(" ");
      const actorId = (req as any).user?.id ?? null;

      const application = await prisma.$transaction(async (tx) => {
        const app = await tx.dealerApplication.create({
          data: {
            intent: "DEALERSHIP_APPLICATION",
            legalName,
            contactName: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
            email: lead.email,
            phone: lead.phone,
            city: b.city ?? lead.city,
            state: b.state ?? lead.state,
            pincode: b.pincode ?? lead.pincode,
            investmentCapacity: b.investmentCapacity ?? null,
            stage: "APPLICATION",
            status: "IN_PROGRESS",
            assignedTeam: "NETWORK_EXPANSION",
            leadId: lead.id,
          },
        });

        const specs = ONBOARDING_DOC_CATALOG["APPLICATION"];
        if (specs.length) {
          await tx.dealerApplicationDocument.createMany({
            data: specs.map((s) => ({ applicationId: app.id, stage: "APPLICATION" as const, docKey: s.docKey, label: s.label, required: s.required ?? true })),
          });
        }
        await tx.onboardingStageEvent.create({
          data: { applicationId: app.id, fromStage: null, toStage: "APPLICATION", note: `Converted from lead #${lead.id}`, actorId },
        });
        await tx.lead.update({ where: { id }, data: { status: "CONVERTED" } });
        await tx.leadRemark.create({ data: { leadId: id, userId: actorId ?? lead.ownerId ?? 1, remark: `Converted to dealer application ${app.publicId}` } });

        return app;
      });

      res.status(201).json(application);
    } catch (error) {
      handleError(error, res, "Convert lead to dealer application");
    }
  }

  // -------------------------------------------------------------------------
  // DELETE /api/v1/leads/:id — soft delete
  // -------------------------------------------------------------------------
  async remove(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Lead ID is required", "id", "Delete lead");

      await prisma.lead.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: (req as any).user?.id ?? null },
      });
      res.status(204).send();
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Lead", "Delete lead");
      handleError(error, res, "Delete lead");
    }
  }

  // -------------------------------------------------------------------------
  // POST /api/v1/leads/:id/remarks — body: { remark }
  // -------------------------------------------------------------------------
  async addRemark(req: Request, res: Response) {
    try {
      const leadId = parseInt(req.params.id as string);
      if (!leadId) return handleValidationError(res, "Lead ID is required", "id", "Add remark");
      const remarkText = (req.body?.remark ?? "").toString().trim();
      if (!remarkText) return handleValidationError(res, "remark is required", "remark", "Add remark");

      const userId = (req as any).user?.id;
      const remark = await prisma.leadRemark.create({
        data: { leadId, userId, remark: remarkText },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      });
      res.status(201).json(remark);
    } catch (error) {
      handleError(error, res, "Add remark");
    }
  }
}
