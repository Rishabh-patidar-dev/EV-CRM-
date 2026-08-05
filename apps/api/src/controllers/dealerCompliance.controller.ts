// ============================================================================
// NEW SUBMODULE — Compliance & Document Renewals
// ----------------------------------------------------------------------------
// Ongoing post-go-live compliance tracking: dealer agreement, trade license,
// insurance, statutory NOCs — each with an expiry date. `status` is always
// recomputed from `expiresAt` before being returned (and persisted if it
// drifted), so a record never silently shows a stale VALID after it expires.
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { computeComplianceStatus } from "../services/dealerManagement.service.js";

/** Recompute + persist status for any record whose cached status has drifted. */
async function refreshStatuses(where: { dealerId?: number }) {
  const records = await prisma.dealerComplianceRecord.findMany({ where });
  const stale = records.filter((r) => computeComplianceStatus(r.expiresAt) !== r.status);
  await Promise.all(
    stale.map((r) =>
      prisma.dealerComplianceRecord.update({
        where: { id: r.id },
        data: { status: computeComplianceStatus(r.expiresAt) },
      })
    )
  );
}

export class DealerComplianceController {
  // GET /api/v1/dealer-compliance  (?dealerId=&status=&docType=)
  async list(req: Request, res: Response) {
    try {
      const { dealerId, status, docType } = req.query;
      const where: any = {};
      if (dealerId) where.dealerId = parseInt(dealerId as string);
      if (docType) where.docType = docType;

      await refreshStatuses(dealerId ? { dealerId: parseInt(dealerId as string) } : {});
      if (status) where.status = status;

      const records = await prisma.dealerComplianceRecord.findMany({
        where,
        include: { dealer: { select: { id: true, dealerCode: true, legalName: true } } },
        orderBy: [{ status: "asc" }, { expiresAt: "asc" }],
      });
      res.json({ records });
    } catch (error) {
      handleError(error, res, "List compliance records");
    }
  }

  // GET /api/v1/dealer-compliance/summary — network-wide counts by status
  async summary(_req: Request, res: Response) {
    try {
      await refreshStatuses({});
      const grouped = await prisma.dealerComplianceRecord.groupBy({ by: ["status"], _count: true });
      res.json({ byStatus: Object.fromEntries(grouped.map((r) => [r.status, r._count])) });
    } catch (error) {
      handleError(error, res, "Compliance summary");
    }
  }

  // POST /api/v1/dealer-compliance — create/upsert a record for a dealer+docType
  async upsert(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.dealerId || !b.docType) {
        return handleValidationError(res, "dealerId and docType are required", "body", "Upsert compliance record");
      }
      const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
      const record = await prisma.dealerComplianceRecord.upsert({
        where: { dealerId_docType: { dealerId: parseInt(b.dealerId), docType: b.docType } },
        create: {
          dealerId: parseInt(b.dealerId),
          docType: b.docType,
          docNumber: b.docNumber ?? null,
          issuedAt: b.issuedAt ? new Date(b.issuedAt) : null,
          expiresAt,
          fileUrl: b.fileUrl ?? null,
          notes: b.notes ?? null,
          status: computeComplianceStatus(expiresAt),
        },
        update: {
          docNumber: b.docNumber ?? undefined,
          issuedAt: b.issuedAt ? new Date(b.issuedAt) : undefined,
          expiresAt,
          fileUrl: b.fileUrl ?? undefined,
          notes: b.notes ?? undefined,
          status: computeComplianceStatus(expiresAt),
        },
      });
      res.status(201).json(record);
    } catch (error) {
      handleError(error, res, "Upsert compliance record");
    }
  }

  // PATCH /api/v1/dealer-compliance/:id
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Record ID is required", "id", "Update compliance record");
      const b = req.body ?? {};

      const data: any = {};
      for (const f of ["docNumber", "fileUrl", "notes"]) if (b[f] !== undefined) data[f] = b[f];
      if (b.issuedAt !== undefined) data.issuedAt = b.issuedAt ? new Date(b.issuedAt) : null;
      if (b.expiresAt !== undefined) {
        data.expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
        data.status = computeComplianceStatus(data.expiresAt);
      }

      const record = await prisma.dealerComplianceRecord.update({ where: { id }, data });
      res.json(record);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Compliance record", "Update compliance record");
      handleError(error, res, "Update compliance record");
    }
  }

  // POST /api/v1/dealer-compliance/:id/remind — log that a renewal reminder was sent
  async remind(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Record ID is required", "id", "Send compliance reminder");
      const record = await prisma.dealerComplianceRecord.update({
        where: { id },
        data: { reminderSentAt: new Date() },
      });
      res.json(record);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Compliance record", "Send compliance reminder");
      handleError(error, res, "Send compliance reminder");
    }
  }
}
