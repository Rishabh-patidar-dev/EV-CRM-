import { Router } from "express";
import multer from "multer";
import { requireDealerPortalAuth } from "../middleware/dealerPortalAuth.middleware.js";
import { DealerPortalController } from "../controllers/dealerPortal.controller.js";

// Buffers held in memory, never touch disk directly — fileStorage.service.ts
// takes the raw buffer and either pushes it to Supabase Storage or (dev
// fallback) writes it to apps/api/uploads itself. Unlike the older
// warranty/dealer-application uploaders (diskStorage), nothing here assumes
// local disk is where the file ends up.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const portal = new DealerPortalController();
const router = Router();
router.use(requireDealerPortalAuth);

router.get("/overview", portal.overview.bind(portal));
router.get("/search", portal.search.bind(portal));
router.get("/vehicle-catalog", portal.vehicleCatalog.bind(portal));

router.get("/vehicle-units", portal.listVehicleUnits.bind(portal));

router.get("/stock-transfers", portal.listStockTransfers.bind(portal));
router.post("/stock-transfers", portal.createStockTransfer.bind(portal));

router.get("/spare-parts", portal.listSpareParts.bind(portal));
router.post("/spare-parts", portal.createSparePart.bind(portal));

router.get("/invoices", portal.listInvoices.bind(portal));

// Dealer's response to an out-of-stock partial-fulfillment offer.
router.post("/stock-transfers/:id/notice-response", portal.respondToStockTransferNotice.bind(portal));
router.post("/spare-parts/:id/notice-response", portal.respondToSparePartNotice.bind(portal));

router.get("/service-tickets", portal.listServiceTickets.bind(portal));
router.post("/service-tickets", portal.createServiceTicket.bind(portal));
router.get("/service-tickets/:id", portal.getServiceTicket.bind(portal));
router.patch("/service-tickets/:id", portal.updateServiceTicketStatus.bind(portal));
router.post("/service-tickets/:id/parts", portal.addServiceTicketPart.bind(portal));
router.delete("/service-tickets/:id/parts/:usageId", portal.removeServiceTicketPart.bind(portal));

router.get("/spare-parts-stock", portal.listDealerSpareParts.bind(portal));
router.post("/spare-parts-stock", portal.upsertDealerSparePart.bind(portal));
router.patch("/spare-parts-stock/:id", portal.updateDealerSparePart.bind(portal));

router.get("/warranty-claims", portal.listWarrantyClaims.bind(portal));
router.post("/warranty-claims", portal.createWarrantyClaim.bind(portal));
router.get("/warranty-coverage/:identifier", portal.checkWarrantyCoverage.bind(portal));

router.get("/leads", portal.listLeads.bind(portal));
router.post("/leads", portal.createLead.bind(portal));
router.get("/leads/:id", portal.getLead.bind(portal));
router.patch("/leads/:id", portal.updateLeadAssignment.bind(portal));
router.post("/leads/:id/remarks", portal.addLeadRemark.bind(portal));

router.get("/segments", portal.listSegments.bind(portal));
router.post("/segments", portal.createSegment.bind(portal));
router.delete("/segments/:id", portal.deleteSegment.bind(portal));

router.get("/campaigns", portal.listCampaigns.bind(portal));
router.post("/campaigns", portal.createCampaign.bind(portal));
router.patch("/campaigns/:id", portal.updateCampaign.bind(portal));

// Sales & Booking
router.get("/bookings", portal.listBookings.bind(portal));
router.get("/bookings/available-units", portal.listAvailableUnitsForBooking.bind(portal));
router.post("/bookings", portal.createBooking.bind(portal));
router.patch("/bookings/:id", portal.updateBooking.bind(portal));

// Billing / GST Invoicing
router.get("/billable-bookings", portal.listBillableBookings.bind(portal));
router.get("/billable-service-tickets", portal.listBillableServiceTickets.bind(portal));
router.get("/bills", portal.listBills.bind(portal));
router.post("/bills", portal.createBill.bind(portal));
router.get("/bills/:id/gst-invoice", portal.getGstInvoice.bind(portal));
router.patch("/bills/:id/payment", portal.recordBillPayment.bind(portal));
router.patch("/bills/:id", portal.cancelBill.bind(portal));

router.post("/bills/:id/eway-bill", portal.generateEwayBill.bind(portal));
router.patch("/eway-bills/:id", portal.cancelEwayBill.bind(portal));

// File attachments (Supabase Storage / local-disk dev fallback — see
// services/fileStorage.service.ts) — one generic Attachment row per file,
// reused across every parent type below rather than 4 near-identical tables.
router.get("/customer-bills/:id/attachments", portal.listAttachments("CUSTOMER_BILL"));
router.post("/customer-bills/:id/attachments", upload.single("file"), portal.uploadAttachment("CUSTOMER_BILL"));
router.get("/service-tickets/:id/attachments", portal.listAttachments("SERVICE_TICKET"));
router.post("/service-tickets/:id/attachments", upload.single("file"), portal.uploadAttachment("SERVICE_TICKET"));
router.get("/bookings/:id/attachments", portal.listAttachments("BOOKING"));
router.post("/bookings/:id/attachments", upload.single("file"), portal.uploadAttachment("BOOKING"));
router.get("/warranty-claims/:id/attachments", portal.listAttachments("WARRANTY_CLAIM"));
router.post("/warranty-claims/:id/attachments", upload.single("file"), portal.uploadAttachment("WARRANTY_CLAIM"));
router.delete("/attachments/:id", portal.deleteAttachment.bind(portal));

// Purchase invoices — dealer logs a supplier/OEM invoice; OCR (plain text
// only) runs at upload time so the dealer has a copy-paste reference for
// filling in the real fields themselves (no auto-fill).
router.post("/purchase-invoices/ocr-preview", upload.single("file"), portal.previewPurchaseInvoiceOcr.bind(portal));
router.get("/purchase-invoices", portal.listPurchaseInvoices.bind(portal));
router.post("/purchase-invoices", portal.createPurchaseInvoice.bind(portal));
router.get("/purchase-invoices/:id", portal.getPurchaseInvoice.bind(portal));
router.patch("/purchase-invoices/:id", portal.updatePurchaseInvoice.bind(portal));

export default router;
