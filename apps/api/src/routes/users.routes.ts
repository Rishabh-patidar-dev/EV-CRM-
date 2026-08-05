import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { UserController } from "../controllers/users.controller.js";

const router = Router();
const c = new UserController();

router.use(requireAuth);
router.get("/", c.list.bind(c));

export default router;
