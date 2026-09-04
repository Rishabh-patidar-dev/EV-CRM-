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
import { prisma, Prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";

// Exported so the dealer-portal Campaign Management endpoints
// (dealerPortal.controller.ts) build member-count queries with the exact
// same logic — a dealer-owned segment (dealerId set) always gets an
// additional hard intersection with that dealer's own assigned leads via the
// DealerLeadAssignment join, so its live membership can never actually
// resolve to another dealer's contacts no matter what status/source/state
// filters are set on it.
export function segmentWhere(s: { statusFilter: string | null; sourceFilter: string | null; stateFilter: string | null; dealerId?: number | null }) {
  const where: any = { deletedAt: null };
  if (s.statusFilter) where.status = s.statusFilter;
  if (s.sourceFilter) where.source = s.sourceFilter;
  if (s.stateFilter) where.state = s.stateFilter;
  if (s.dealerId) where.dealerAssignment = { dealerId: s.dealerId };
  return where;
}

// ---------------------------------------------------------------------------
// Segment membership counts
// ---------------------------------------------------------------------------
// This used to be one `lead.count()` per segment, fired in parallel inside a
// Promise.all. Two problems with that at scale:
//
//   * It is N queries for one page. With 40 segments that is 40 round trips.
//   * They all launch at once against a pool of a handful of connections, so a
//     single request to this endpoint can occupy the entire pool and stall
//     every other request on the worker behind it. A few concurrent users on
//     this one page were enough to starve the rest of the API.
//
// Every segment filters on some combination of three scalar columns, so the
// whole page can be answered by grouping leads on those columns once and
// summing the groups in memory. Dealer-owned segments additionally intersect
// with that dealer's assigned leads, which is a relation and can't be grouped
// alongside — so they get one grouped query per distinct dealer.
//
// Result: 1 + (distinct dealers) queries instead of N. For the dealer portal,
// where every segment belongs to the one signed-in dealer, that is a single query.
// ---------------------------------------------------------------------------
type SegmentFilters = {
  statusFilter: string | null;
  sourceFilter: string | null;
  stateFilter: string | null;
  dealerId?: number | null;
};

type LeadGroup = { status: string | null; source: string | null; state: string | null; _count: { _all: number } };

function sumMatching(groups: LeadGroup[], s: SegmentFilters): number {
  let total = 0;
  for (const g of groups) {
    if (s.statusFilter && g.status !== s.statusFilter) continue;
    if (s.sourceFilter && g.source !== s.sourceFilter) continue;
    if (s.stateFilter && g.state !== s.stateFilter) continue;
    total += g._count._all;
  }
  return total;
}

export async function attachMemberCounts<T extends SegmentFilters>(segments: T[]): Promise<(T & { memberCount: number })[]> {
  if (segments.length === 0) return [];

  const dealerIds = [...new Set(segments.map((s) => s.dealerId).filter((id): id is number => typeof id === "number"))];
  const needsNetworkWide = segments.some((s) => !s.dealerId);

  const groupLeadsBy = (where: Prisma.LeadWhereInput) =>
    prisma.lead.groupBy({
      by: ["status", "source", "state"],
      _count: { _all: true },
      where,
    }) as unknown as Promise<LeadGroup[]>;

  const [networkGroups, ...dealerGroupSets] = await Promise.all([
    needsNetworkWide ? groupLeadsBy({ deletedAt: null }) : Promise.resolve([] as LeadGroup[]),
    ...dealerIds.map((dealerId) => groupLeadsBy({ deletedAt: null, dealerAssignment: { dealerId } })),
  ]);

  const byDealer = new Map<number, LeadGroup[]>();
  dealerIds.forEach((id, i) => byDealer.set(id, dealerGroupSets[i] ?? []));

  return segments.map((s) => ({
    ...s,
    memberCount: sumMatching(s.dealerId ? (byDealer.get(s.dealerId) ?? []) : networkGroups, s),
  }));
}

export class SegmentController {
  // GET /api/v1/campaign-management/segments
  async list(_req: Request, res: Response) {
    try {
      const segments = await prisma.segment.findMany({ orderBy: { createdAt: "desc" } });
      res.json({ segments: await attachMemberCounts(segments) });
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
