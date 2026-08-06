import { Router } from "express";
import { AuthController } from "../controllers/auth.controller.js";

const router = Router();
const auth = new AuthController();

router.post("/login", auth.login.bind(auth));
router.get("/me", auth.me.bind(auth));
router.post("/logout", auth.logout.bind(auth));

export default router;
