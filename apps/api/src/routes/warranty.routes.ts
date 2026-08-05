import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  WarrantyPlanController,
  ComponentUnitController,
  WarrantyClaimController,
  SupplierRecoveryController,
} from "../controllers/warranty.controller.js";

const ADMINS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
const plans = new WarrantyPlanController();
const componentUnits = new ComponentUnitController();
const claims = new WarrantyClaimController();
const recoveries = new SupplierRecoveryController();

// ---- /api/v1/warranty-plans ----
const planRouter = Router();
planRouter.use(requireAuth);
planRouter.get("/", requireRole(ADMINS), plans.list.bind(plans));
planRouter.post("/", requireRole(ADMINS), plans.create.bind(plans));
planRouter.patch("/:id", requireRole(ADMINS), plans.update.bind(plans));

// ---- /api/v1/component-units ----
const componentUnitRouter = Router();
componentUnitRouter.use(requireAuth);
componentUnitRouter.get("/coverage/:identifier", requireRole(ADMINS), componentUnits.coverage.bind(componentUnits));
componentUnitRouter.get("/", requireRole(ADMINS), componentUnits.list.bind(componentUnits));
componentUnitRouter.post("/", requireRole(ADMINS), componentUnits.create.bind(componentUnits));

// ---- /api/v1/warranty-claims ----
const claimRouter = Router();
claimRouter.use(requireAuth);
claimRouter.get("/", requireRole(ADMINS), claims.list.bind(claims));
claimRouter.post("/", requireRole(ADMINS), claims.create.bind(claims));
claimRouter.get("/:id", requireRole(ADMINS), claims.getById.bind(claims));
claimRouter.post("/:id/status", requireRole(ADMINS), claims.setStatus.bind(claims));
claimRouter.post("/:claimId/supplier-recovery", requireRole(ADMINS), recoveries.create.bind(recoveries));

// ---- /api/v1/supplier-recoveries ----
const recoveryRouter = Router();
recoveryRouter.use(requireAuth);
recoveryRouter.get("/", requireRole(ADMINS), recoveries.list.bind(recoveries));
recoveryRouter.patch("/:id", requireRole(ADMINS), recoveries.update.bind(recoveries));

export default { plans: planRouter, componentUnits: componentUnitRouter, claims: claimRouter, recoveries: recoveryRouter };
