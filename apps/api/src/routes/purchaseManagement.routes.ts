import { Router } from "express";
import { UserRole } from "@repo/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { PurchaseManagementController } from "../controllers/purchaseManagement.controller.js";

const ADMINS = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];
const controller = new PurchaseManagementController();

const router = Router();
router.use(requireAuth);
router.get("/orders", requireRole(ADMINS), controller.list.bind(controller));
router.post("/orders", requireRole(ADMINS), controller.create.bind(controller));
router.patch("/orders/:id", requireRole(ADMINS), controller.update.bind(controller));
router.post("/orders/:id/receive", requireRole(ADMINS), controller.receiveGoods.bind(controller));
router.post("/orders/:id/payment", requireRole(ADMINS), controller.recordPayment.bind(controller));
router.get("/vendors", requireRole(ADMINS), controller.listVendors.bind(controller));
router.post("/vendors", requireRole(ADMINS), controller.createVendor.bind(controller));
router.patch("/vendors/:id", requireRole(ADMINS), controller.updateVendor.bind(controller));
router.get("/analytics", requireRole(ADMINS), controller.analytics.bind(controller));

// Read-only — dealers log these themselves via the DMS portal
// (dealerPortal.controller.ts). No approval/dispute workflow here, just
// visibility for staff into what each dealer has logged.
router.get("/dealer-invoices", requireRole(ADMINS), controller.listDealerInvoices.bind(controller));
router.get("/dealer-invoices/:id", requireRole(ADMINS), controller.getDealerInvoice.bind(controller));

export default router;
