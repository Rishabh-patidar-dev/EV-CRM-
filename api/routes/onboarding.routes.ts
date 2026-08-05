// Place in: apps/api/src/routes/onboarding.routes.ts
// Mount PROTECTED in routes/index.ts: app.use("/api/v1/onboarding", onboardingRoutes);
import { Router } from "express";
import { OnboardingController } from "../controllers/onboarding.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { UserRole } from "@prisma/client";

const router = Router();
const c = new OnboardingController();

router.use(requireAuth);

const staff = requireRole([UserRole.ADMIN, UserRole.SYSTEM_ADMIN]);

router.get("/board", staff, c.board.bind(c));
router.get("/applications", staff, c.list.bind(c));
router.get("/applications/:id", staff, c.getById.bind(c));
router.post("/applications/:id/advance", staff, c.advance.bind(c));
router.post("/applications/:id/:action(hold|reject)", staff, c.setStatus.bind(c));
router.patch("/documents/:docId", staff, c.updateDocument.bind(c));

export default router;
