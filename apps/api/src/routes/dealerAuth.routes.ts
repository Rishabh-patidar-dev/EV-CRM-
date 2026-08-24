import { Router } from "express";
import multer from "multer";
import { DealerAuthController } from "../controllers/dealerAuth.controller.js";

// memoryStorage — same pattern as the purchase-invoice upload route.
// uploadDocument() hands the buffer to fileStorage.service.ts, which
// itself branches on Supabase Storage vs. local-disk fallback.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();
const c = new DealerAuthController();

router.post("/signup", c.signup.bind(c));
router.post("/login", c.login.bind(c));
router.post("/logout", c.logout.bind(c));
router.get("/me", c.me.bind(c));
router.get("/application", c.getApplication.bind(c));
router.post("/documents", upload.single("file"), c.uploadDocument.bind(c));

export default router;
