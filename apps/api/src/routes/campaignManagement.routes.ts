import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { SegmentController, MarketingCampaignController } from "../controllers/campaignManagement.controller.js";

const ADMINS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
// Marketing's home module, additive to ADMINS — see docs/ARCHITECTURE_AND_FLOWS.md §4.
const MARKETING_STAFF = [...ADMINS, UserRole.MARKETING];
const segments = new SegmentController();
const campaigns = new MarketingCampaignController();

const router = Router();
router.use(requireAuth);
router.get("/segments", requireRole(MARKETING_STAFF), segments.list.bind(segments));
router.post("/segments", requireRole(MARKETING_STAFF), segments.create.bind(segments));
router.delete("/segments/:id", requireRole(MARKETING_STAFF), segments.remove.bind(segments));
router.get("/campaigns", requireRole(MARKETING_STAFF), campaigns.list.bind(campaigns));
router.post("/campaigns", requireRole(MARKETING_STAFF), campaigns.create.bind(campaigns));
router.patch("/campaigns/:id", requireRole(MARKETING_STAFF), campaigns.update.bind(campaigns));

export default router;
