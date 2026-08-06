// ============================================================================
// CENTREPIECE MODULE — Warranty Management
// ----------------------------------------------------------------------------
// Four controllers implementing the Phase-1 core from
// DMS-and-Warranty-Research.pdf §4:
//   WarrantyPlanController    — policy data (§4.4a)
//   ComponentUnitController   — serial registration (§4.4b) + instant
//                                coverage check (§4.4c)
//   WarrantyClaimController   — dealer claim intake (§4.4d), auto-adjudication
//                                (§4.4e/Appendix B), approval workflow (§4.4f),
//                                reimbursement (§4.4h)
//   SupplierRecoveryController — the closed loop (§4.4i)
// ============================================================================
import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { handleError, handleValidationError, handleNotFoundError } from "../utils/errorHandler.js";
import { generateSequenceNumber } from "../services/dealerManagement.service.js";
import { adjudicateClaim } from "../services/warrantyAdjudication.service.js";

// -----------------------------------------------------------------------------
export class WarrantyPlanController {
  // GET /api/v1/warranty-plans  (?vehicleModel=&componentType=&isActive=)
  async list(req: Request, res: Response) {
    try {
      const { vehicleModel, componentType, isActive } = req.query;
      const where: any = {};
      if (vehicleModel) where.vehicleModel = vehicleModel;
      if (componentType) where.componentType = componentType;
      if (isActive !== undefined) where.isActive = isActive === "true";

      const plans = await prisma.warrantyPlan.findMany({
        where,
        orderBy: [{ vehicleModel: "asc" }, { componentType: "asc" }],
      });
      res.json({ plans });
    } catch (error) {
      handleError(error, res, "List warranty plans");
    }
  }

  // POST /api/v1/warranty-plans
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.name || !b.vehicleModel || !b.componentType || !b.termMonths) {
        return handleValidationError(res, "name, vehicleModel, componentType and termMonths are required", "body", "Create warranty plan");
      }
      const plan = await prisma.warrantyPlan.create({
        data: {
          name: b.name,
          vehicleModel: b.vehicleModel,
          componentType: b.componentType,
          termMonths: parseInt(b.termMonths),
          termKm: b.termKm ?? null,
          sohFloorPct: b.sohFloorPct ?? null,
          approvedChargers: b.approvedChargers ?? null,
        },
      });
      res.status(201).json(plan);
    } catch (error: any) {
      if (error.code === "P2002") return handleValidationError(res, "A plan already exists for this model + component", "vehicleModel", "Create warranty plan");
      handleError(error, res, "Create warranty plan");
    }
  }

  // PATCH /api/v1/warranty-plans/:id
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Plan ID is required", "id", "Update warranty plan");
      const b = req.body ?? {};
      const data: any = {};
      for (const f of ["name", "termMonths", "termKm", "sohFloorPct", "approvedChargers", "isActive"]) {
        if (b[f] !== undefined) data[f] = b[f];
      }
      const plan = await prisma.warrantyPlan.update({ where: { id }, data });
      res.json(plan);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Warranty plan", "Update warranty plan");
      handleError(error, res, "Update warranty plan");
    }
  }
}

// -----------------------------------------------------------------------------
export class ComponentUnitController {
  // GET /api/v1/component-units  (?vehicleUnitId=&componentType=&search=)
  async list(req: Request, res: Response) {
    try {
      const { vehicleUnitId, componentType, search = "" } = req.query;
      const where: any = {};
      if (vehicleUnitId) where.vehicleUnitId = parseInt(vehicleUnitId as string);
      if (componentType) where.componentType = componentType;
      if (search) where.serialNumber = { contains: search as string };

      const units = await prisma.componentUnit.findMany({
        where,
        include: {
          vehicleUnit: { select: { id: true, vin: true, model: true, dealerId: true } },
          plan: { select: { id: true, name: true, termMonths: true, termKm: true, sohFloorPct: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      res.json({ componentUnits: units });
    } catch (error) {
      handleError(error, res, "List component units");
    }
  }

  // POST /api/v1/component-units — register a serial, fitted to a vehicle
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.serialNumber || !b.componentType) {
        return handleValidationError(res, "serialNumber and componentType are required", "body", "Register component unit");
      }

      let planId: number | null = b.planId ?? null;
      if (!planId && b.vehicleUnitId) {
        const vehicleUnit = await prisma.vehicleUnit.findUnique({ where: { id: parseInt(b.vehicleUnitId) } });
        if (vehicleUnit) {
          const plan = await prisma.warrantyPlan.findUnique({
            where: { vehicleModel_componentType: { vehicleModel: vehicleUnit.model, componentType: b.componentType } },
          });
          planId = plan?.id ?? null;
        }
      }

      const unit = await prisma.componentUnit.create({
        data: {
          serialNumber: b.serialNumber,
          componentType: b.componentType,
          supplierName: b.supplierName ?? null,
          batchNumber: b.batchNumber ?? null,
          vehicleUnitId: b.vehicleUnitId ? parseInt(b.vehicleUnitId) : null,
          planId,
          registeredAt: b.registeredAt ? new Date(b.registeredAt) : new Date(),
        },
      });
      res.status(201).json(unit);
    } catch (error: any) {
      if (error.code === "P2002") return handleValidationError(res, "A component with this serial number is already registered", "serialNumber", "Register component unit");
      handleError(error, res, "Register component unit");
    }
  }

  // GET /api/v1/component-units/coverage/:identifier — instant in-warranty
  // check by chassis (VIN) or a single component serial number (§4.4c).
  async coverage(req: Request, res: Response) {
    try {
      const identifier = String(req.params.identifier ?? "").trim();
      if (!identifier) return handleValidationError(res, "identifier is required", "identifier", "Coverage check");

      const vehicleUnit = await prisma.vehicleUnit.findUnique({
        where: { vin: identifier },
        include: { componentUnits: { include: { plan: true } } },
      });

      let componentUnits = vehicleUnit?.componentUnits ?? [];
      let matchedVehicle = vehicleUnit;

      if (componentUnits.length === 0) {
        // Not a VIN (or no components on it yet) — try as a component serial.
        const single = await prisma.componentUnit.findUnique({
          where: { serialNumber: identifier },
          include: { plan: true, vehicleUnit: { include: { componentUnits: { include: { plan: true } } } } },
        });
        if (single) {
          matchedVehicle = single.vehicleUnit;
          componentUnits = single.vehicleUnit?.componentUnits ?? [single];
        }
      }

      if (!matchedVehicle && componentUnits.length === 0) {
        return handleNotFoundError(res, "Vehicle or component", "Coverage check");
      }

      const now = Date.now();
      const coverage = componentUnits.map((c) => {
        const plan = (c as any).plan;
        let inWarranty: boolean | null = null;
        let expiresAt: Date | null = null;
        if (plan && c.registeredAt) {
          expiresAt = new Date(c.registeredAt);
          expiresAt.setMonth(expiresAt.getMonth() + plan.termMonths);
          inWarranty = now <= expiresAt.getTime();
        }
        return {
          serialNumber: c.serialNumber,
          componentType: c.componentType,
          registeredAt: c.registeredAt,
          plan: plan ? { name: plan.name, termMonths: plan.termMonths, termKm: plan.termKm, sohFloorPct: plan.sohFloorPct } : null,
          inWarranty,
          expiresAt,
        };
      });

      res.json({
        vehicle: matchedVehicle ? { id: matchedVehicle.id, vin: matchedVehicle.vin, model: matchedVehicle.model, dealerId: matchedVehicle.dealerId } : null,
        components: coverage,
      });
    } catch (error) {
      handleError(error, res, "Coverage check");
    }
  }
}

// -----------------------------------------------------------------------------
export class WarrantyClaimController {
  // GET /api/v1/warranty-claims  (?dealerId=&status=&page=&limit=)
  async list(req: Request, res: Response) {
    try {
      const { dealerId, status, page = "1", limit = "20" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));

      const where: any = {};
      if (dealerId) where.dealerId = parseInt(dealerId as string);
      if (status) where.status = status;

      const [claims, total, pipeline] = await Promise.all([
        prisma.warrantyClaim.findMany({
          where,
          include: {
            dealer: { select: { id: true, dealerCode: true, legalName: true } },
            componentUnit: { select: { id: true, serialNumber: true, componentType: true } },
            supplierRecovery: true,
          },
          orderBy: { submittedAt: "desc" },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.warrantyClaim.count({ where }),
        prisma.warrantyClaim.groupBy({ by: ["status"], _count: true, where: dealerId ? { dealerId: parseInt(dealerId as string) } : {} }),
      ]);

      res.json({
        claims,
        pipeline: Object.fromEntries(pipeline.map((r) => [r.status, r._count])),
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      });
    } catch (error) {
      handleError(error, res, "List warranty claims");
    }
  }

  // POST /api/v1/warranty-claims/:id/documents  (multipart, field "files", up to 5)
  // Evidence photos/PDFs attached at intake or during review. Disk storage
  // under apps/api/uploads/warranty (see routes/warranty.routes.ts for the
  // multer config), served back via the static /uploads mount in index.ts.
  async uploadDocuments(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Claim ID is required", "id", "Upload claim documents");

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) return handleValidationError(res, "No files were uploaded", "files", "Upload claim documents");

      const claim = await prisma.warrantyClaim.findUnique({ where: { id }, select: { documentPaths: true } });
      if (!claim) return handleNotFoundError(res, "Warranty claim", "Upload claim documents");

      const newPaths = files.map((f) => `/uploads/warranty/${f.filename}`);
      const updated = await prisma.warrantyClaim.update({
        where: { id },
        data: { documentPaths: [...claim.documentPaths, ...newPaths] },
        select: { id: true, documentPaths: true },
      });

      res.status(201).json(updated);
    } catch (error) {
      handleError(error, res, "Upload claim documents");
    }
  }

  // GET /api/v1/warranty-claims/:id
  async getById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Claim ID is required", "id", "Get warranty claim");

      const claim = await prisma.warrantyClaim.findUnique({
        where: { id },
        include: {
          dealer: { select: { id: true, dealerCode: true, legalName: true } },
          vehicleUnit: { select: { id: true, vin: true, model: true } },
          componentUnit: { include: { plan: true } },
          plan: true,
          supplierRecovery: true,
          events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { id: true, firstName: true, lastName: true } } } },
        },
      });
      if (!claim) return handleNotFoundError(res, "Warranty claim", "Get warranty claim");
      res.json(claim);
    } catch (error) {
      handleError(error, res, "Get warranty claim");
    }
  }

  // POST /api/v1/warranty-claims — dealer-raised intake, auto-adjudicated on arrival
  async create(req: Request, res: Response) {
    try {
      const b = req.body ?? {};
      if (!b.dealerId || !b.customerName || !b.issueDescription) {
        return handleValidationError(res, "dealerId, customerName and issueDescription are required", "body", "Create warranty claim");
      }

      const componentUnit = b.componentUnitId
        ? await prisma.componentUnit.findUnique({ where: { id: parseInt(b.componentUnitId) }, include: { plan: true } })
        : null;

      const hasOpenDuplicateClaim = componentUnit
        ? (await prisma.warrantyClaim.count({
            where: {
              componentUnitId: componentUnit.id,
              status: { in: ["SUBMITTED", "UNDER_REVIEW", "INFO_REQUESTED", "APPROVED", "IN_REPAIR"] },
            },
          })) > 0
        : false;

      const adjudication = adjudicateClaim({
        plan: componentUnit?.plan
          ? {
              termMonths: componentUnit.plan.termMonths,
              termKm: componentUnit.plan.termKm,
              sohFloorPct: componentUnit.plan.sohFloorPct,
              approvedChargers: componentUnit.plan.approvedChargers,
            }
          : null,
        componentRegisteredAt: componentUnit?.registeredAt ?? null,
        claim: {
          odometerReading: b.odometerReading ?? null,
          measuredSohPct: b.measuredSohPct ?? null,
          chargerType: b.chargerType ?? null,
          serviceRecordsComplete: b.serviceRecordsComplete !== false,
        },
        hasOpenDuplicateClaim,
      });

      const initialStatus = adjudication.decision === "AUTO_APPROVE" ? "APPROVED" : adjudication.decision === "VOID" ? "REJECTED" : "UNDER_REVIEW";

      const claimNumber = await generateSequenceNumber("WC", () => prisma.warrantyClaim.count());
      const actorId = (req as any).user?.id ?? null;

      const claim = await prisma.$transaction(async (tx) => {
        const created = await tx.warrantyClaim.create({
          data: {
            claimNumber,
            dealerId: parseInt(b.dealerId),
            vehicleUnitId: b.vehicleUnitId ? parseInt(b.vehicleUnitId) : componentUnit?.vehicleUnitId ?? null,
            componentUnitId: componentUnit?.id ?? null,
            planId: componentUnit?.planId ?? null,
            chassisNumber: b.chassisNumber ?? null,
            customerName: b.customerName,
            customerPhone: b.customerPhone ?? null,
            issueDescription: b.issueDescription,
            odometerReading: b.odometerReading ?? null,
            measuredSohPct: b.measuredSohPct ?? null,
            chargerType: b.chargerType ?? null,
            serviceRecordsComplete: b.serviceRecordsComplete !== false,
            claimAmount: b.claimAmount ?? null,
            approvedAmount: initialStatus === "APPROVED" ? b.claimAmount ?? null : null,
            status: initialStatus,
            voidReason: adjudication.decision === "VOID" ? adjudication.reasons.join(" ") : null,
            adjudicationNotes: adjudication.reasons.join(" "),
          },
        });
        await tx.warrantyClaimEvent.create({
          data: {
            claimId: created.id,
            fromStatus: null,
            toStatus: initialStatus,
            note: `Auto-adjudication: ${adjudication.decision}. ${adjudication.reasons.join(" ")}`,
            actorId,
          },
        });
        return created;
      });

      res.status(201).json({ ...claim, adjudication });
    } catch (error) {
      handleError(error, res, "Create warranty claim");
    }
  }

  // POST /api/v1/warranty-claims/:id/status
  //   body: { status, note?, approvedAmount?, rejectionReason? }
  async setStatus(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Claim ID is required", "id", "Update warranty claim status");
      const status = req.body?.status;
      if (!status) return handleValidationError(res, "status is required", "status", "Update warranty claim status");

      const current = await prisma.warrantyClaim.findUnique({ where: { id } });
      if (!current) return handleNotFoundError(res, "Warranty claim", "Update warranty claim status");

      const actorId = (req as any).user?.id ?? null;
      const note: string | undefined = req.body?.note;

      const updated = await prisma.$transaction(async (tx) => {
        const data: any = { status };
        if (req.body?.approvedAmount !== undefined) data.approvedAmount = req.body.approvedAmount;
        if (req.body?.rejectionReason !== undefined) data.rejectionReason = req.body.rejectionReason;
        if (status === "IN_REPAIR" && req.body?.partReturned) {
          data.partReturned = true;
          data.partReturnedAt = new Date();
        }
        if (["REJECTED", "CLOSED"].includes(status)) data.resolvedAt = new Date();

        const next = await tx.warrantyClaim.update({ where: { id }, data });

        await tx.warrantyClaimEvent.create({
          data: { claimId: id, fromStatus: current.status, toStatus: status, note: note ?? null, actorId },
        });

        return next;
      });

      res.json(updated);
    } catch (error) {
      handleError(error, res, "Update warranty claim status");
    }
  }
}

// -----------------------------------------------------------------------------
export class SupplierRecoveryController {
  // GET /api/v1/supplier-recoveries  (?status=)
  async list(req: Request, res: Response) {
    try {
      const { status } = req.query;
      const where: any = {};
      if (status) where.status = status;

      const recoveries = await prisma.supplierRecovery.findMany({
        where,
        include: {
          claim: {
            select: {
              id: true, claimNumber: true, customerName: true,
              dealer: { select: { id: true, dealerCode: true, legalName: true } },
            },
          },
        },
        orderBy: { openedAt: "desc" },
      });
      res.json({ recoveries });
    } catch (error) {
      handleError(error, res, "List supplier recoveries");
    }
  }

  // POST /api/v1/warranty-claims/:claimId/supplier-recovery — open a recovery case
  async create(req: Request, res: Response) {
    try {
      const claimId = parseInt(req.params.claimId as string);
      if (!claimId) return handleValidationError(res, "Claim ID is required", "claimId", "Open supplier recovery");
      const b = req.body ?? {};
      if (!b.supplierName || !b.componentType || b.amount == null) {
        return handleValidationError(res, "supplierName, componentType and amount are required", "body", "Open supplier recovery");
      }

      const claim = await prisma.warrantyClaim.findUnique({ where: { id: claimId } });
      if (!claim) return handleNotFoundError(res, "Warranty claim", "Open supplier recovery");

      const recovery = await prisma.$transaction(async (tx) => {
        const created = await tx.supplierRecovery.create({
          data: {
            claimId,
            supplierName: b.supplierName,
            componentType: b.componentType,
            amount: b.amount,
            notes: b.notes ?? null,
          },
        });
        await tx.warrantyClaim.update({ where: { id: claimId }, data: { status: "RECOVERY" } });
        await tx.warrantyClaimEvent.create({
          data: { claimId, fromStatus: claim.status, toStatus: "RECOVERY", note: `Supplier recovery opened against ${b.supplierName}`, actorId: (req as any).user?.id ?? null },
        });
        return created;
      });

      res.status(201).json(recovery);
    } catch (error: any) {
      if (error.code === "P2002") return handleValidationError(res, "A recovery case already exists for this claim", "claimId", "Open supplier recovery");
      handleError(error, res, "Open supplier recovery");
    }
  }

  // PATCH /api/v1/supplier-recoveries/:id — body: { status, notes? }
  async update(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (!id) return handleValidationError(res, "Recovery ID is required", "id", "Update supplier recovery");
      const b = req.body ?? {};
      const data: any = {};
      if (b.status !== undefined) {
        data.status = b.status;
        if (["RECOVERED", "WRITTEN_OFF"].includes(b.status)) data.closedAt = new Date();
      }
      if (b.notes !== undefined) data.notes = b.notes;

      const recovery = await prisma.$transaction(async (tx) => {
        const updated = await tx.supplierRecovery.update({ where: { id }, data });
        if (data.closedAt) {
          const claim = await tx.warrantyClaim.findUnique({ where: { id: updated.claimId } });
          if (claim) {
            await tx.warrantyClaim.update({ where: { id: updated.claimId }, data: { status: "CLOSED", resolvedAt: new Date() } });
            await tx.warrantyClaimEvent.create({
              data: { claimId: updated.claimId, fromStatus: claim.status, toStatus: "CLOSED", note: `Recovery ${b.status.toLowerCase()}`, actorId: (req as any).user?.id ?? null },
            });
          }
        }
        return updated;
      });

      res.json(recovery);
    } catch (error: any) {
      if (error.code === "P2025") return handleNotFoundError(res, "Supplier recovery", "Update supplier recovery");
      handleError(error, res, "Update supplier recovery");
    }
  }
}
