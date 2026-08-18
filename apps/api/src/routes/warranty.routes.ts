import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  WarrantyPlanController,
  ComponentUnitController,
  WarrantyClaimController,
  SupplierRecoveryController,
} from "../controllers/warranty.controller.js";

// Claim evidence (photos/PDFs) — local disk, same pattern as the landing
// portal's own upload storage: no external service, gated behind auth.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "..", "uploads", "warranty");
fs.mkdirSync(uploadsDir, { recursive: true });
const claimUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

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
componentUnitRouter.patch("/:id", requireRole(ADMINS), componentUnits.update.bind(componentUnits));

// ---- /api/v1/warranty-claims ----
const claimRouter = Router();
claimRouter.use(requireAuth);
claimRouter.get("/", requireRole(ADMINS), claims.list.bind(claims));
claimRouter.post("/", requireRole(ADMINS), claims.create.bind(claims));
claimRouter.get("/analytics/cost", requireRole(ADMINS), claims.costAnalytics.bind(claims));
claimRouter.get("/:id", requireRole(ADMINS), claims.getById.bind(claims));
claimRouter.post("/:id/documents", requireRole(ADMINS), claimUpload.array("files", 5), claims.uploadDocuments.bind(claims));
claimRouter.post("/:id/status", requireRole(ADMINS), claims.setStatus.bind(claims));
claimRouter.post("/:claimId/supplier-recovery", requireRole(ADMINS), recoveries.create.bind(recoveries));

// ---- /api/v1/supplier-recoveries ----
const recoveryRouter = Router();
recoveryRouter.use(requireAuth);
recoveryRouter.get("/", requireRole(ADMINS), recoveries.list.bind(recoveries));
recoveryRouter.patch("/:id", requireRole(ADMINS), recoveries.update.bind(recoveries));

export default { plans: planRouter, componentUnits: componentUnitRouter, claims: claimRouter, recoveries: recoveryRouter };
