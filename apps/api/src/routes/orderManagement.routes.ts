import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { OrderManagementController } from "../controllers/orderManagement.controller.js";

const ADMINS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
// Order Management's home departments — Sales/Order Desk owns the general
// order desk, Warehouse owns the stock-truth steps (Check Inventory,
// Close Orders). Both are additive to ADMINS, never a restriction on it.
// See docs/ARCHITECTURE_AND_FLOWS.md §4 for the full department mapping.
const ORDER_DESK = [...ADMINS, UserRole.SALES, UserRole.RELATIONSHIP_MANAGER];
const WAREHOUSE_STAFF = [...ADMINS, UserRole.WAREHOUSE];
const controller = new OrderManagementController();

const router = Router();
router.use(requireAuth);
router.get("/orders", requireRole(ORDER_DESK), controller.list.bind(controller));
router.get("/analytics", requireRole(ORDER_DESK), controller.analytics.bind(controller));
router.get("/zones", requireRole(ORDER_DESK), controller.zones.bind(controller));
router.get("/new-count", requireRole(ORDER_DESK), controller.newCount.bind(controller));
router.get("/invoices", requireRole(ORDER_DESK), controller.listInvoices.bind(controller));
router.post("/invoices", requireRole(ORDER_DESK), controller.createInvoice.bind(controller));
router.get("/vehicle-catalog", requireRole(ORDER_DESK), controller.vehicleCatalog.bind(controller));

// Check Inventory + Close Orders — Warehouse's stage of the order flow.
router.get("/orders/:type/:id/check-inventory", requireRole(WAREHOUSE_STAFF), controller.getInventoryCheck.bind(controller));
router.post("/orders/:type/:id/check-inventory", requireRole(WAREHOUSE_STAFF), controller.runInventoryCheck.bind(controller));
router.get("/Close", requireRole(WAREHOUSE_STAFF), controller.listClose.bind(controller));
router.post("/Close/:type/:id/notice", requireRole(WAREHOUSE_STAFF), controller.sendNotice.bind(controller));
router.post("/Close/:type/:id/resolve", requireRole(WAREHOUSE_STAFF), controller.resolveDispute.bind(controller));

export default router;
