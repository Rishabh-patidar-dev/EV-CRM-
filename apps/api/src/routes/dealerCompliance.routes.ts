import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { DealerComplianceController } from "../controllers/dealerCompliance.controller.js";

const ADMINS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
const c = new DealerComplianceController();

const router = Router();
router.use(requireAuth);
router.get("/summary", requireRole(ADMINS), c.summary.bind(c));
router.get("/", requireRole(ADMINS), c.list.bind(c));
router.post("/", requireRole(ADMINS), c.upsert.bind(c));
router.patch("/:id", requireRole(ADMINS), c.update.bind(c));
router.post("/:id/remind", requireRole(ADMINS), c.remind.bind(c));

export default router;
