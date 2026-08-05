// =============================================================================
//  onboarding.controller.ts  —  Module 3: Dealer Onboarding process monitoring
//
//  SQLite adaptation of /api/controllers/onboarding.controller.ts: the
//  `mode: "insensitive"` argument on the search `contains` filters was
//  dropped (SQLite connector doesn't support it — Postgres-only collation
//  hint). SQLite's LIKE, which `contains` compiles to, is already
//  case-insensitive for ASCII text, so search behaviour is unchanged.
// =============================================================================

import { Request, Response } from "express";
import { prisma } from "@repo/db";
import {
  handleError,
  handleValidationError,
  handleNotFoundError,
} from "../utils/errorHandler.js";
import {
  ONBOARDING_DOC_CATALOG,
  STAGE_ORDER,
  stageIndex,
} from "../services/applicationRouting.service.js";

export class OnboardingController {
  /** GET /api/v1/onboarding/applications?stage=&status=&search=&page=&limit= */
  async list(req: Request, res: Response) {
    try {
      const { stage, status, search = "", page = "1", limit = "20" } = req.query as Record<string, string>;
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

      const where: any = {};
      if (stage) where.stage = stage;
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { legalName: { contains: search } },
          { tradeName: { contains: search } },
          { email: { contains: search } },
          { publicId: { contains: search } },
        ];
      }

      const [applications, total] = await Promise.all([
        prisma.dealerApplication.findMany({
          where,
          include: {
            assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
            _count: { select: { documents: true } },
          },
          orderBy: { updatedAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.dealerApplication.count({ where }),
      ]);

      res.json({
        applications,
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      });
    } catch (error) {
      handleError(error, res, "List dealer applications");
    }
  }

  /** GET /api/v1/onboarding/board — counts grouped by stage (for the pipeline board). */
  async board(_req: Request, res: Response) {
    try {
      const grouped = await prisma.dealerApplication.groupBy({
        by: ["stage"],
        where: { status: { in: ["IN_PROGRESS", "ON_HOLD"] } },
        _count: { _all: true },
      });
      const counts: Record<string, number> = {};
      for (const s of STAGE_ORDER) counts[s as string] = 0;
      for (const g of grouped) counts[g.stage] = g._count._all;
      res.json({ stages: STAGE_ORDER, counts });
    } catch (error) {
      handleError(error, res, "Onboarding board");
    }
  }

  /** GET /api/v1/onboarding/applications/:id */
  async getById(req: Request, res: Response) {
    try {
      const id = parseInt(String(req.params.id ?? ""));
      if (!id) return handleValidationError(res, "Application ID required", "id", "Get application");

      const application = await prisma.dealerApplication.findUnique({
        where: { id },
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
          lead: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          documents: { orderBy: [{ stage: "asc" }, { docKey: "asc" }] },
          stageHistory: {
            orderBy: { createdAt: "asc" },
            include: { actor: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
      });

      if (!application) return handleNotFoundError(res, "Dealer Application", "Get application");
      res.json(application);
    } catch (error) {
      handleError(error, res, "Get application");
    }
  }

  /**
   * POST /api/v1/onboarding/applications/:id/advance
   * Body: { note?: string }
   * Forward-only transition. On success, seeds the next stage's document
   * checklist and records a stage event. Reaching OPERATIONAL marks APPROVED.
   */
  async advance(req: Request, res: Response) {
    try {
      const id = parseInt(String(req.params.id ?? ""));
      if (!id) return handleValidationError(res, "Application ID required", "id", "Advance stage");
      const actorId = (req as any).user?.id ?? null;
      const note: string | undefined = req.body?.note;

      const app = await prisma.dealerApplication.findUnique({
        where: { id },
        include: { documents: true },
      });
      if (!app) return handleNotFoundError(res, "Dealer Application", "Advance stage");
      if (app.status === "REJECTED" || app.status === "WITHDRAWN") {
        return handleValidationError(res, `Cannot advance a ${app.status} application`, "status", "Advance stage");
      }

      const curIdx = stageIndex(app.stage);
      if (curIdx < 0 || curIdx >= STAGE_ORDER.length - 1) {
        return handleValidationError(res, "Application is already at the final stage", "stage", "Advance stage");
      }

      // Gate: every REQUIRED document in the current stage must be VERIFIED.
      const blocking = app.documents.filter(
        (d) => d.stage === app.stage && d.required && d.status !== "VERIFIED"
      );
      if (blocking.length > 0) {
        return res.status(409).json({
          message: "Required documents for the current stage are not all verified.",
          pending: blocking.map((d) => ({ docKey: d.docKey, label: d.label, status: d.status })),
        });
      }

      const target = STAGE_ORDER[curIdx + 1]!;
      const isTerminal = target === ("OPERATIONAL" as typeof target);

      const updated = await prisma.$transaction(async (tx) => {
        const next = await tx.dealerApplication.update({
          where: { id },
          data: { stage: target, status: isTerminal ? "APPROVED" : "IN_PROGRESS" },
        });

        // Seed next stage checklist. SQLite's createMany has no
        // skipDuplicates (Postgres-only) — filter out any docKeys already
        // seeded for this stage instead, so re-entering a stage stays
        // idempotent under the @@unique([applicationId, stage, docKey]).
        const specs = ONBOARDING_DOC_CATALOG[target] ?? [];
        if (specs.length) {
          const existing = await tx.dealerApplicationDocument.findMany({
            where: { applicationId: id, stage: target },
            select: { docKey: true },
          });
          const existingKeys = new Set(existing.map((d) => d.docKey));
          const toCreate = specs.filter((s) => !existingKeys.has(s.docKey));
          if (toCreate.length) {
            await tx.dealerApplicationDocument.createMany({
              data: toCreate.map((s) => ({
                applicationId: id,
                stage: target,
                docKey: s.docKey,
                label: s.label,
                required: s.required ?? true,
              })),
            });
          }
        }

        await tx.onboardingStageEvent.create({
          data: { applicationId: id, fromStage: app.stage, toStage: target, actorId, note: note ?? null },
        });

        return next;
      });

      res.json(updated);
    } catch (error) {
      handleError(error, res, "Advance stage");
    }
  }

  /** POST /api/v1/onboarding/applications/:id/hold|reject  Body: { note } */
  async setStatus(req: Request, res: Response) {
    try {
      const id = parseInt(String(req.params.id ?? ""));
      const status = String(req.params.action ?? "").toUpperCase() === "REJECT" ? "REJECTED" : "ON_HOLD";
      if (!id) return handleValidationError(res, "Application ID required", "id", "Set status");
      const actorId = (req as any).user?.id ?? null;

      const app = await prisma.dealerApplication.findUnique({ where: { id }, select: { stage: true } });
      if (!app) return handleNotFoundError(res, "Dealer Application", "Set status");

      const updated = await prisma.$transaction(async (tx) => {
        const next = await tx.dealerApplication.update({ where: { id }, data: { status } });
        await tx.onboardingStageEvent.create({
          data: { applicationId: id, fromStage: app.stage, toStage: app.stage, actorId, note: `Status → ${status}${req.body?.note ? `: ${req.body.note}` : ""}` },
        });
        return next;
      });
      res.json(updated);
    } catch (error) {
      handleError(error, res, "Set status");
    }
  }

  /** PATCH /api/v1/onboarding/documents/:docId  Body: { status, fileUrl?, notes? } */
  async updateDocument(req: Request, res: Response) {
    try {
      const docId = parseInt(String(req.params.docId ?? ""));
      if (!docId) return handleValidationError(res, "Document ID required", "docId", "Update document");
      const { status, fileUrl, notes } = req.body ?? {};
      const actorId = (req as any).user?.id ?? null;

      const allowed = ["PENDING", "UPLOADED", "VERIFIED", "REJECTED"];
      if (status && !allowed.includes(status)) {
        return handleValidationError(res, "Invalid document status", "status", "Update document");
      }

      const doc = await prisma.dealerApplicationDocument.update({
        where: { id: docId },
        data: {
          ...(status && { status }),
          ...(fileUrl !== undefined && { fileUrl }),
          ...(notes !== undefined && { notes }),
          ...(status === "VERIFIED" && { verifiedById: actorId, verifiedAt: new Date() }),
        },
      });
      res.json(doc);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Document", "Update document");
      handleError(error, res, "Update document");
    }
  }
}
