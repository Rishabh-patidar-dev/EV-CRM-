// ============================================================================
// Landing Page Campaign — ported from innocrm-staging's
// apps/api/src/controllers/landingPageCampaign.controller.ts. Logic is
// unchanged; the only edits are SQLite adaptations (mode: "insensitive"
// dropped — see dealerManagement.service.ts for why) and the renamed
// Enquiry.enquiryCreatedAt field.
//
// A campaign's `uniqueId` is the one thing the external landing page needs
// to know about our side of the integration: it's passed back in every
// webhook payload (`landing_page_campaign_id`) so an enquiry/application can
// be attributed to the page/ad that produced it.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";

export class LandingPageCampaignController {
  // GET /api/v1/landing-page-campaigns  (?search=&status=&page=&limit=)
  async list(req: Request, res: Response) {
    try {
      const { page = "1", limit = "10", search = "", status } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};
      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: "insensitive" } },
          { description: { contains: search as string, mode: "insensitive" } },
        ];
      }
      if (status) where.status = status;

      const [campaigns, total] = await Promise.all([
        prisma.landingPageCampaign.findMany({
          where,
          include: {
            creator: { select: { id: true, firstName: true, lastName: true, email: true } },
            _count: { select: { enquiries: true, applications: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limitNum,
        }),
        prisma.landingPageCampaign.count({ where }),
      ]);

      res.json({
        campaigns,
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      });
    } catch (error) {
      handleError(error, res, "List landing page campaigns");
    }
  }

  // GET /api/v1/landing-page-campaigns/stats
  async stats(_req: Request, res: Response) {
    try {
      const [activeCampaigns, nonArchivedCampaigns, totalEnquiries, unresolvedEnquiries, totalApplications] =
        await Promise.all([
          prisma.landingPageCampaign.count({ where: { status: "ACTIVE" } }),
          prisma.landingPageCampaign.count({ where: { status: { not: "ARCHIVED" } } }),
          prisma.enquiry.count(),
          prisma.enquiry.count({ where: { status: "UNRESOLVED" } }),
          prisma.dealerApplication.count(),
        ]);

      res.json({ activeCampaigns, totalCampaigns: nonArchivedCampaigns, totalEnquiries, unresolvedEnquiries, totalApplications });
    } catch (error) {
      handleError(error, res, "Landing page campaign stats");
    }
  }

  // POST /api/v1/landing-page-campaigns
  async create(req: Request, res: Response) {
    try {
      const { name, description, status, gtmContainerId } = req.body ?? {};
      if (!name) return handleValidationError(res, "Campaign name is required", "name", "Create campaign");

      const campaign = await prisma.landingPageCampaign.create({
        data: {
          name,
          description: description ?? null,
          status: status || "ACTIVE",
          gtmContainerId: gtmContainerId ?? null,
          createdBy: (req as any).user?.id ?? null,
        },
        include: { creator: { select: { id: true, firstName: true, lastName: true, email: true } } },
      });
      res.status(201).json(campaign);
    } catch (error) {
      handleError(error, res, "Create campaign");
    }
  }

  // GET /api/v1/landing-page-campaigns/:id
  async getById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Campaign ID is required", "id", "Get campaign");

      const campaign = await prisma.landingPageCampaign.findUnique({
        where: { id },
        include: {
          creator: { select: { id: true, firstName: true, lastName: true, email: true } },
          enquiries: {
            include: { lead: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
            orderBy: { enquiryCreatedAt: "desc" },
            take: 50,
          },
          applications: {
            select: { id: true, publicId: true, legalName: true, stage: true, status: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 50,
          },
          _count: { select: { enquiries: true, applications: true } },
        },
      });

      if (!campaign) return handleNotFoundError(res, "Landing page campaign", "Get campaign");
      res.json(campaign);
    } catch (error) {
      handleError(error, res, "Get campaign");
    }
  }

  // GET /api/v1/landing-page-campaigns/unique/:uniqueId — public, for the external landing page to self-check
  async getByUniqueId(req: Request, res: Response) {
    try {
      const uniqueId = req.params.uniqueId ? String(req.params.uniqueId) : "";
      if (!uniqueId) return handleValidationError(res, "uniqueId is required", "uniqueId", "Get campaign by unique id");

      const campaign = await prisma.landingPageCampaign.findUnique({
        where: { uniqueId },
        select: { id: true, name: true, description: true, uniqueId: true, status: true, gtmContainerId: true },
      });
      if (!campaign) return handleNotFoundError(res, "Landing page campaign", "Get campaign by unique id");
      res.json(campaign);
    } catch (error) {
      handleError(error, res, "Get campaign by unique id");
    }
  }

  // PATCH /api/v1/landing-page-campaigns/:id
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Campaign ID is required", "id", "Update campaign");
      const { name, description, status, gtmContainerId } = req.body ?? {};

      const campaign = await prisma.landingPageCampaign.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(status && { status }),
          ...(gtmContainerId !== undefined && { gtmContainerId }),
        },
        include: { creator: { select: { id: true, firstName: true, lastName: true, email: true } } },
      });
      res.json(campaign);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Landing page campaign", "Update campaign");
      handleError(error, res, "Update campaign");
    }
  }

  // DELETE /api/v1/landing-page-campaigns/:id
  async remove(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Campaign ID is required", "id", "Delete campaign");
      await prisma.landingPageCampaign.delete({ where: { id } });
      res.status(204).send();
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Landing page campaign", "Delete campaign");
      handleError(error, res, "Delete campaign");
    }
  }
}
