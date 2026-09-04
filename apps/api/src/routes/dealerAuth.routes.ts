import { Router } from "express";
import multer from "multer";
import { DealerAuthController } from "../controllers/dealerAuth.controller.js";
import { authRateLimit, uploadRateLimit } from "../middleware/security.js";
import { env } from "../config/env.js";

// memoryStorage — same pattern as the purchase-invoice upload route.
// uploadDocument() hands the buffer to fileStorage.service.ts, which
// itself branches on Supabase Storage vs. local-disk fallback.
//
// `files: 1` matters as much as the size cap: without it a single multipart
// request may carry unlimited parts, so the effective memory ceiling is the
// attacker's choice rather than ours.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
});

const router = Router();
const c = new DealerAuthController();

router.post("/signup", authRateLimit, c.signup.bind(c));
router.post("/login", authRateLimit, c.login.bind(c));
router.post("/logout", c.logout.bind(c));
router.get("/me", c.me.bind(c));
router.get("/application", c.getApplication.bind(c));
// Upload + OCR: CPU-heavy and memory-heavy, so it gets its own tighter limit.
router.post("/documents", uploadRateLimit, upload.single("file"), c.uploadDocument.bind(c));

export default router;
