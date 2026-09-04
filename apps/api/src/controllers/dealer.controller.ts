// ============================================================================
// Dealer Management — core controller
// ----------------------------------------------------------------------------
// SQLite adaptations of /api/controllers/dealer.controller.ts:
//   - `mode: "insensitive"` was originally dropped here because SQLite does
//     not support it and its `contains` is already case-insensitive for
//     ASCII. That stopped being true when this moved to Postgres, where
//     `contains` compiles to a case-SENSITIVE LIKE — so searching "sample
//     motors" silently stopped matching "Sample Motors". The modes are back.
//   - Dealer.segments is a comma-joined String column here, so every read
//     path runs it through parseSegments() before sending JSON, and every
//     write path runs it through serializeSegments(); the segment filter in
//     list() switched from the Postgres-only array `has` to `contains`.
//   - createFromApplication no longer copies DealerApplication.tier onto
//     Dealer.tier — those are two different enums (onboarding's assessed
//     tier vs. the operational network tier), so that assignment was a
//     latent type bug in the original; it now always defaults STANDARD like
//     the plain create() path does, and can be adjusted via the request body.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { BILLABLE_INVOICE_TYPES } from "../services/receivables.service.js";
import { parsePagination, parseSort } from "../utils/query.js";
import {
  generateDealerCode,
  computeAttainment,
  currentPeriodStart,
  normalizePhone,
  serializeSegments,
  parseSegments,
} from "../services/dealerManagement.service.js";

// Columns the dealer list may be sorted by. Every one is either indexed or
// low-cardinality; anything not on this list is refused by parseSort.
const DEALER_SORTABLE = ["createdAt", "legalName", "dealerCode", "tier", "status", "state"] as const;

function withSegments<T extends { segments: string }>(dealer: T) {
  return { ...dealer, segments: parseSegments(dealer.segments) };
}

export class DealerController {
  // -------------------------------------------------------------------------
  // GET /api/v1/dealers  — paginated, filterable list
  //   ?search= &state= &tier= &status= &segment= &page= &limit=
  // -------------------------------------------------------------------------
  async list(req: Request, res: Response) {
    try {
      const { search = "", state, tier, status, segment } = req.query;

      const { page: pageNum, limit: limitNum, skip } = parsePagination(req);
      // `orderBy: { [req.query.sortBy]: ... }` used to pass a client-supplied
      // string straight to Prisma: an unknown column produced a 500, and any
      // unindexed one bought the caller a full-table sort at the database's
      // expense. Only these columns are sortable now, and anything else falls
      // back to createdAt.
      const orderBy = parseSort(req, DEALER_SORTABLE, "createdAt");

      const where: any = {};
      if (search) {
        where.OR = [
          { legalName: { contains: search as string, mode: "insensitive" } },
          { tradeName: { contains: search as string, mode: "insensitive" } },
          { dealerCode: { contains: search as string, mode: "insensitive" } },
          { principalName: { contains: search as string, mode: "insensitive" } },
        ];
      }
      if (state) where.state = { equals: state as string };
      if (tier) where.tier = tier;
      if (status) where.status = status;
      if (segment) where.segments = { contains: segment as string, mode: "insensitive" };

      const [dealers, total] = await Promise.all([
        prisma.dealer.findMany({
          where,
          include: {
            relationshipManager: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
            _count: {
              select: {
                territories: true,
                leadAssignments: true,
                serviceTickets: true,
              },
            },
          },
          orderBy,
          skip,
          take: limitNum,
        }),
        prisma.dealer.count({ where }),
      ]);

      res.json({
        dealers: dealers.map(withSegments),
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      handleError(error, res, "List dealers");
    }
  }

  // -------------------------------------------------------------------------
  // GET /api/v1/dealers/stats — network dashboard counts
  // -------------------------------------------------------------------------
  async stats(_req: Request, res: Response) {
    try {
      const [byStatus, byTier, byState, byCity, totalDealers, billedAgg, collectedAgg, openService] =
        await Promise.all([
          prisma.dealer.groupBy({ by: ["status"], _count: true }),
          prisma.dealer.groupBy({ by: ["tier"], _count: true }),
          prisma.dealer.groupBy({ by: ["state"], _count: true }),
          prisma.dealer.groupBy({ by: ["city"], _count: true }),
          prisma.dealer.count(),
          // Network-wide receivable — same "only delivered goods are a
          // payable" rule Finance Management uses (see
          // services/receivables.service.ts). Network totals don't need the
          // per-dealer FIFO pass: summed billed minus summed collected is
          // the same number.
          prisma.invoice.aggregate({ _sum: { totalAmount: true }, where: { type: { in: [...BILLABLE_INVOICE_TYPES] } } }),
          prisma.dealerPayment.aggregate({ _sum: { amount: true } }),
          prisma.serviceTicket.count({
            where: { status: { in: ["OPEN", "IN_PROGRESS", "AWAITING_PARTS"] } },
          }),
        ]);

      const billed = Number(billedAgg._sum.totalAmount ?? 0);
      const collected = Number(collectedAgg._sum.amount ?? 0);

      res.json({
        totalDealers,
        statesCovered: byState.length,
        citiesCovered: byCity.length,
        outstandingReceivable: Math.max(0, Math.round(billed - collected)),
        openServiceTickets: openService,
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
        byTier: Object.fromEntries(byTier.map((r) => [r.tier, r._count])),
        byState: byState
          .map((r) => ({ state: r.state, count: r._count }))
          .sort((a, b) => b.count - a.count),
      });
    } catch (error) {
      handleError(error, res, "Dealer stats");
    }
  }

  // -------------------------------------------------------------------------
  // GET /api/v1/dealers/:id — full operational detail + current attainment
  // -------------------------------------------------------------------------
  async getById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Dealer ID is required", "id", "Get dealer");

      const dealer = await prisma.dealer.findUnique({
        where: { id },
        include: {
          relationshipManager: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          territories: { orderBy: [{ state: "asc" }, { district: "asc" }] },
          targets: { orderBy: { periodStart: "desc" }, take: 12 },
          performance: { orderBy: { periodStart: "desc" }, take: 12 },
          payments: { orderBy: { paidAt: "desc" }, take: 20 },
          serviceTickets: { orderBy: { createdAt: "desc" }, take: 20 },
          sparePartRequests: { orderBy: { createdAt: "desc" }, take: 20 },
          leadAssignments: { orderBy: { assignedAt: "desc" }, take: 20 },
          vehicleUnits: { orderBy: { createdAt: "desc" }, take: 20 },
          stockTransferRequests: { orderBy: { createdAt: "desc" }, take: 20 },
          complianceRecords: { orderBy: { expiresAt: "asc" } },
          warrantyClaims: { orderBy: { createdAt: "desc" }, take: 20 },
        },
      });

      if (!dealer) return handleNotFoundError(res, "Dealer", "Get dealer");

      // Current-period attainment (combined, all segments)
      const periodStart = currentPeriodStart("MONTHLY");
      const target =
        dealer.targets.find(
          (t) => t.segment === null && +t.periodStart === +periodStart
        ) ?? null;
      const actual =
        dealer.performance.find((p) => +p.periodStart === +periodStart) ?? null;

      const attainment = computeAttainment(
        target ? { unitTarget: target.unitTarget, revenueTarget: target.revenueTarget ? Number(target.revenueTarget) : null } : null,
        actual
          ? {
              unitsSold: actual.unitsSold,
              revenue: Number(actual.revenue),
              leadsReceived: actual.leadsReceived,
              leadsConverted: actual.leadsConverted,
            }
          : null
      );

      // What this dealer still owes — same rule Finance Management applies
      // (only delivered goods create a payable, see
      // services/receivables.service.ts).
      const [billedAgg, collectedAgg] = await Promise.all([
        prisma.invoice.aggregate({ _sum: { totalAmount: true }, where: { dealerId: id, type: { in: [...BILLABLE_INVOICE_TYPES] } } }),
        prisma.dealerPayment.aggregate({ _sum: { amount: true }, where: { dealerId: id } }),
      ]);
      const outstandingReceivable = Math.max(
        0,
        Math.round(Number(billedAgg._sum.totalAmount ?? 0) - Number(collectedAgg._sum.amount ?? 0))
      );

      res.json({
        ...withSegments(dealer),
        outstandingReceivable,
        currentAttainment: attainment,
      });
    } catch (error) {
      handleError(error, res, "Get dealer");
    }
  }

  // -------------------------------------------------------------------------
  // POST /api/v1/dealers — create an operational dealer directly
  // -------------------------------------------------------------------------
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.legalName || !b.principalName || !b.phone || !b.state) {
        return handleValidationError(
          res,
          "legalName, principalName, phone and state are required",
          "body",
          "Create dealer"
        );
      }

      const dealerCode = b.dealerCode || (await generateDealerCode(b.state));

      const dealer = await prisma.dealer.create({
        data: {
          legalName: b.legalName,
          tradeName: b.tradeName ?? null,
          dealerCode,
          gstNumber: b.gstNumber ?? null,
          panNumber: b.panNumber ?? null,
          principalName: b.principalName,
          phone: normalizePhone(b.phone) ?? b.phone,
          email: b.email ?? null,
          addressLine: b.addressLine ?? null,
          city: b.city ?? null,
          district: b.district ?? null,
          state: b.state,
          pincode: b.pincode ?? null,
          tier: b.tier ?? "STANDARD",
          status: b.status ?? "ONBOARDING",
          segments: serializeSegments(b.segments),
          relationshipManagerId: b.relationshipManagerId ?? null,
          creditLimit: b.creditLimit ?? null,
          securityDeposit: b.securityDeposit ?? null,
          appointedAt: b.appointedAt ? new Date(b.appointedAt) : null,
          applicationId: b.applicationId ?? null,
          notes: b.notes ?? null,
        },
      });

      res.status(201).json(withSegments(dealer));
    } catch (error) {
      handleError(error, res, "Create dealer");
    }
  }

  // -------------------------------------------------------------------------
  // POST /api/v1/dealers/from-application/:applicationId
  //   Promote an approved onboarding application into an operational dealer.
  // -------------------------------------------------------------------------
  async createFromApplication(req: Request, res: Response) {
    try {
      const applicationId = parseInt(req.params.applicationId as string);
      if (!applicationId)
        return handleValidationError(res, "applicationId is required", "applicationId", "Promote application");

      const app = await prisma.dealerApplication.findUnique({ where: { id: applicationId } });
      if (!app) return handleNotFoundError(res, "Dealer application", "Promote application");

      const existing = await prisma.dealer.findUnique({ where: { applicationId } });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: "This application has already been promoted to a dealer",
          dealerId: existing.id,
        });
      }

      const state = app.state ?? req.body?.state ?? "";
      if (!state) {
        return handleValidationError(
          res,
          "Application has no state; pass { state } in the body",
          "state",
          "Promote application"
        );
      }

      const dealerCode = await generateDealerCode(state);
      const dealer = await prisma.dealer.create({
        data: {
          legalName: app.legalName ?? "Unnamed dealer",
          tradeName: app.tradeName ?? null,
          dealerCode,
          gstNumber: app.gstin ?? null,
          panNumber: app.pan ?? null,
          principalName: app.contactName ?? "—",
          phone: app.phone ?? "—",
          email: app.email ?? null,
          city: app.city ?? null,
          state,
          pincode: app.pincode ?? null,
          tier: req.body?.tier ?? "STANDARD",
          segments: serializeSegments(req.body?.segments),
          status: "ACTIVE",
          appointedAt: new Date(),
          goLiveAt: new Date(),
          applicationId,
        },
      });

      res.status(201).json(withSegments(dealer));
    } catch (error) {
      handleError(error, res, "Promote application to dealer");
    }
  }

  // -------------------------------------------------------------------------
  // PATCH /api/v1/dealers/:id — update mutable fields (incl. status changes)
  // -------------------------------------------------------------------------
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Dealer ID is required", "id", "Update dealer");
      const b = req.body ?? {};

      const data: any = {};
      const fields = [
        "legalName", "tradeName", "gstNumber", "panNumber", "principalName",
        "email", "addressLine", "city", "district", "state", "pincode",
        "tier", "status", "relationshipManagerId", "creditLimit",
        "securityDeposit", "notes",
      ];
      for (const f of fields) if (b[f] !== undefined) data[f] = b[f];
      if (b.phone !== undefined) data.phone = normalizePhone(b.phone) ?? b.phone;
      if (Array.isArray(b.segments)) data.segments = serializeSegments(b.segments);
      if (b.status === "SUSPENDED") data.suspendedAt = new Date();
      if (b.status === "ACTIVE" && b.goLive) data.goLiveAt = new Date();

      const dealer = await prisma.dealer.update({ where: { id }, data });
      res.json(withSegments(dealer));
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Dealer", "Update dealer");
      handleError(error, res, "Update dealer");
    }
  }

  // -------------------------------------------------------------------------
  // PUT /api/v1/dealers/:id/territories — replace the dealer's territory set
  //   body: { territories: [{ state, district?, exclusive? }] }
  // -------------------------------------------------------------------------
  async setTerritories(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Dealer ID is required", "id", "Set territories");
      const territories = Array.isArray(req.body?.territories) ? req.body.territories : [];

      // SQLite's createMany has no skipDuplicates (Postgres-only) — dedupe
      // on (state, district) in JS instead, since the table's already wiped
      // by the deleteMany just above.
      const seen = new Set<string>();
      const rows = territories
        .filter((t: any) => t?.state)
        .map((t: any) => ({
          dealerId: id,
          state: t.state,
          district: t.district ?? null,
          exclusive: !!t.exclusive,
        }))
        .filter((t: { state: string; district: string | null }) => {
          const key = `${t.state}::${t.district ?? ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      await prisma.$transaction([
        prisma.dealerTerritory.deleteMany({ where: { dealerId: id } }),
        prisma.dealerTerritory.createMany({ data: rows }),
      ]);

      const saved = await prisma.dealerTerritory.findMany({ where: { dealerId: id } });
      res.json({ territories: saved });
    } catch (error) {
      handleError(error, res, "Set territories");
    }
  }

  // -------------------------------------------------------------------------
  // PUT /api/v1/dealers/:id/targets — upsert a target for a period/segment
  //   body: { periodType?, periodStart?, segment?, unitTarget, revenueTarget? }
  // -------------------------------------------------------------------------
  async setTarget(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Dealer ID is required", "id", "Set target");
      const b = req.body ?? {};

      const periodType = b.periodType ?? "MONTHLY";
      const periodStart = b.periodStart ? new Date(b.periodStart) : currentPeriodStart(periodType);
      const segment = b.segment ?? null;

      const target = await prisma.dealerTarget.upsert({
        where: {
          dealerId_periodType_periodStart_segment: {
            dealerId: id,
            periodType,
            periodStart,
            segment,
          },
        },
        create: {
          dealerId: id,
          periodType,
          periodStart,
          segment,
          unitTarget: b.unitTarget ?? 0,
          revenueTarget: b.revenueTarget ?? null,
        },
        update: {
          unitTarget: b.unitTarget ?? 0,
          revenueTarget: b.revenueTarget ?? null,
        },
      });

      res.json(target);
    } catch (error) {
      handleError(error, res, "Set target");
    }
  }

  // -------------------------------------------------------------------------
  // PUT /api/v1/dealers/:id/performance — upsert an actuals snapshot
  //   Normally written by a nightly job from Order/Invoice data; exposed here
  //   so you can seed/correct figures manually too.
  // -------------------------------------------------------------------------
  async setPerformance(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Dealer ID is required", "id", "Set performance");
      const b = req.body ?? {};

      const periodType = b.periodType ?? "MONTHLY";
      const periodStart = b.periodStart ? new Date(b.periodStart) : currentPeriodStart(periodType);

      const snap = await prisma.dealerPerformanceSnapshot.upsert({
        where: {
          dealerId_periodType_periodStart: { dealerId: id, periodType, periodStart },
        },
        create: {
          dealerId: id,
          periodType,
          periodStart,
          unitsSold: b.unitsSold ?? 0,
          revenue: b.revenue ?? 0,
          leadsReceived: b.leadsReceived ?? 0,
          leadsConverted: b.leadsConverted ?? 0,
        },
        update: {
          unitsSold: b.unitsSold ?? 0,
          revenue: b.revenue ?? 0,
          leadsReceived: b.leadsReceived ?? 0,
          leadsConverted: b.leadsConverted ?? 0,
        },
      });

      res.json(snap);
    } catch (error) {
      handleError(error, res, "Set performance");
    }
  }
}
