// Protected onboarding pipeline (Network Expansion / Admin). Auth lives
// inside this router, same convention as the delivered bundle.
import { Router } from "express";
import { OnboardingController } from "../controllers/onboarding.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { UserRole } from "@repo/db";

const router = Router();
const c = new OnboardingController();

router.use(requireAuth);

const staff = requireRole([UserRole.ADMIN, UserRole.SYSTEM_ADMIN, UserRole.NETWORK_EXPANSION]);

router.get("/board", staff, c.board.bind(c));
router.get("/applications", staff, c.list.bind(c));
router.get("/applications/:id", staff, c.getById.bind(c));
router.post("/applications/:id/advance", staff, c.advance.bind(c));
// Express 5's router (path-to-regexp v8) dropped inline regex groups like
// `:action(hold|reject)` — constrain the two valid actions with a param
// matcher instead, then let the controller resolve hold vs. reject.
router.param("action", (req, res, next, value) => {
  if (value !== "hold" && value !== "reject") {
    return res.status(404).json({ success: false, message: "Unknown action" });
  }
  next();
});
router.post("/applications/:id/:action", staff, c.setStatus.bind(c));
router.patch("/documents/:docId", staff, c.updateDocument.bind(c));

export default router;
