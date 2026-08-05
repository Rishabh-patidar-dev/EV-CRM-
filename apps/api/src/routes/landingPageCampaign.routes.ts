import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { LandingPageCampaignController } from "../controllers/landingPageCampaign.controller.js";

const MANAGERS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
const c = new LandingPageCampaignController();

const router = Router();
router.use(requireAuth);

router.get("/stats", requireRole(MANAGERS), c.stats.bind(c));
router.get("/", requireRole(MANAGERS), c.list.bind(c));
router.post("/", requireRole(MANAGERS), c.create.bind(c));
router.get("/unique/:uniqueId", c.getByUniqueId.bind(c)); // for the external landing page to self-check
router.get("/:id", requireRole(MANAGERS), c.getById.bind(c));
router.patch("/:id", requireRole(MANAGERS), c.update.bind(c));
router.delete("/:id", requireRole(MANAGERS), c.remove.bind(c));

export default router;
