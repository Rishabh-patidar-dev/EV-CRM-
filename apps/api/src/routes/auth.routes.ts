import { Router } from "express";
import { AuthController } from "../controllers/auth.controller.js";
import { authRateLimit } from "../middleware/security.js";

const router = Router();
const auth = new AuthController();

// authRateLimit is keyed by IP + submitted username and skips successful
// logins, so it throttles guessing without ever getting in a real user's way.
router.post("/login", authRateLimit, auth.login.bind(auth));
router.get("/me", auth.me.bind(auth));
router.post("/logout", auth.logout.bind(auth));

export default router;
