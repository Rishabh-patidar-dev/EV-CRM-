// ============================================================================
// SUBMODULE — Campaign Management (outbound Email/WhatsApp to lead segments)
// ----------------------------------------------------------------------------
// SegmentController: a Segment is a saved filter over the Lead table
// (status/source/state) — membership is never stored, always recomputed
// live, so it can't go stale.
// MarketingCampaignController: targets one Segment over one channel
// (Email/WhatsApp). Sending is NOT wired to a live provider (no SMTP/
// WhatsApp Business API in this scaffold) — "Send" snapshots the segment's
// current live member count as audienceCount and moves the campaign to
// SENT; there is no actual dispatch, open/click/bounce tracking, since none
// of that would be real data.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";

function segmentWhere(s: { statusFilter: string | null; sourceFilter: string | null; stateFilter: string | null }) {
  const where: any = { deletedAt: null };
  if (s.statusFilter) where.status = s.statusFilter;
  if (s.sourceFilter) where.source = s.sourceFilter;
  if (s.stateFilter) where.state = s.stateFilter;
  return where;
}

export class SegmentController {
  // GET /api/v1/campaign-management/segments
  async list(_req: Request, res: Response) {
    try {
      const segments = await prisma.segment.findMany({ orderBy: { createdAt: "desc" } });
      const withCounts = await Promise.all(
        segments.map(async (s) => ({
          ...s,
          memberCount: await prisma.lead.count({ where: segmentWhere(s) }),
        }))
      );
      res.json({ segments: withCounts });
    } catch (error) {
      handleError(error, res, "List segments");
    }
  }

  // POST /api/v1/campaign-management/segments
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.name) return handleValidationError(res, "name is required", "name", "Create segment");
      const segment = await prisma.segment.create({
        data: {
          name: b.name,
          description: b.description ?? null,
          statusFilter: b.statusFilter || null,
          sourceFilter: b.sourceFilter || null,
          stateFilter: b.stateFilter || null,
        },
      });
      const memberCount = await prisma.lead.count({ where: segmentWhere(segment) });
      res.status(201).json({ ...segment, memberCount });
    } catch (error) {
      handleError(error, res, "Create segment");
    }
  }

  // DELETE /api/v1/campaign-management/segments/:id
  async remove(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Segment ID is required", "id", "Delete segment");
      await prisma.segment.delete({ where: { id } });
      res.status(204).send();
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Segment", "Delete segment");
      handleError(error, res, "Delete segment");
    }
  }
}

export class MarketingCampaignController {
  // GET /api/v1/campaign-management/campaigns  (?channel=EMAIL|WHATSAPP&status=)
  async list(req: Request, res: Response) {
    try {
      const { channel, status } = req.query;
      const where: any = {};
      if (channel) where.channel = channel;
      if (status) where.status = status;
      const campaigns = await prisma.marketingCampaign.findMany({
        where,
        include: { segment: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      });
      res.json({ campaigns });
    } catch (error) {
      handleError(error, res, "List marketing campaigns");
    }
  }

  // POST /api/v1/campaign-management/campaigns
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.name || !b.channel || !b.message) {
        return handleValidationError(res, "name, channel and message are required", "body", "Create marketing campaign");
      }
      const campaign = await prisma.marketingCampaign.create({
        data: {
          name: b.name,
          channel: b.channel,
          subject: b.channel === "EMAIL" ? (b.subject ?? null) : null,
          message: b.message,
          segmentId: b.segmentId ? parseInt(b.segmentId) : null,
          scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null,
        },
      });
      res.status(201).json(campaign);
    } catch (error) {
      handleError(error, res, "Create marketing campaign");
    }
  }

  // PATCH /api/v1/campaign-management/campaigns/:id  — body: { status }
  //   status=SENT snapshots the segment's live member count as audienceCount
  //   (there's no real send — see file header).
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Campaign ID is required", "id", "Update marketing campaign");
      const status = req.body?.status;
      if (!status) return handleValidationError(res, "status is required", "status", "Update marketing campaign");

      const campaign = await prisma.marketingCampaign.findUnique({ where: { id }, include: { segment: true } });
      if (!campaign) return handleNotFoundError(res, "Marketing campaign", "Update marketing campaign");

      const data: any = { status };
      if (status === "SENT") {
        data.sentAt = new Date();
        data.audienceCount = campaign.segment ? await prisma.lead.count({ where: segmentWhere(campaign.segment) }) : 0;
      }

      const updated = await prisma.marketingCampaign.update({ where: { id }, data });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Update marketing campaign");
    }
  }
}
