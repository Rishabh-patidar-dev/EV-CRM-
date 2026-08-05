import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { OrderManagementController } from "../controllers/orderManagement.controller.js";

const ADMINS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
const controller = new OrderManagementController();

const router = Router();
router.use(requireAuth);
router.get("/orders", requireRole(ADMINS), controller.list.bind(controller));
router.get("/analytics", requireRole(ADMINS), controller.analytics.bind(controller));

export default router;
