import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { DealerAuthController } from "../controllers/dealerAuth.controller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "..", "uploads", "dealer-applications");
fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = Router();
const c = new DealerAuthController();

router.post("/signup", c.signup.bind(c));
router.post("/login", c.login.bind(c));
router.post("/logout", c.logout.bind(c));
router.get("/me", c.me.bind(c));
router.get("/application", c.getApplication.bind(c));
router.post("/documents", upload.single("file"), c.uploadDocument.bind(c));

export default router;
