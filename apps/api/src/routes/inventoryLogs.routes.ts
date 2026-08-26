import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { InventoryLogsController } from "../controllers/inventoryLogs.controller.js";

const ADMINS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
const STAFF = [...ADMINS, UserRole.SALES, UserRole.RELATIONSHIP_MANAGER, UserRole.WAREHOUSE];
const controller = new InventoryLogsController();

const router = Router();
router.use(requireAuth);
router.get("/", requireRole(STAFF), controller.list.bind(controller));

export default router;
