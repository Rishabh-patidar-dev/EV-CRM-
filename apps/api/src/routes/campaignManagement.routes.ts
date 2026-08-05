import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { SegmentController, MarketingCampaignController } from "../controllers/campaignManagement.controller.js";

const ADMINS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
const segments = new SegmentController();
const campaigns = new MarketingCampaignController();

const router = Router();
router.use(requireAuth);
router.get("/segments", requireRole(ADMINS), segments.list.bind(segments));
router.post("/segments", requireRole(ADMINS), segments.create.bind(segments));
router.delete("/segments/:id", requireRole(ADMINS), segments.remove.bind(segments));
router.get("/campaigns", requireRole(ADMINS), campaigns.list.bind(campaigns));
router.post("/campaigns", requireRole(ADMINS), campaigns.create.bind(campaigns));
router.patch("/campaigns/:id", requireRole(ADMINS), campaigns.update.bind(campaigns));

export default router;
